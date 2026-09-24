"""Suggested scrapes that cover more of a blocked search without paging deeper.

Price bands and Amazon sort orders restart pagination on a smaller or
reordered slice of the same keyword. This module does not change how the
browser behaves.
"""

from __future__ import annotations

import re
from urllib.parse import parse_qsl, urlparse

from app.scraper.urls import (
    apply_slice,
    build_search_url,
    price_bounds_from_url,
    sort_from_url,
    validate_amazon_url,
)

PRICE_BANDS = (
    ("under-25", "Under $25", None, 25.0),
    ("25-50", "$25–$50", 25.0, 50.0),
    ("50-100", "$50–$100", 50.0, 100.0),
    ("100-plus", "$100+", 100.0, None),
)

SORTS = (
    ("featured", "Featured", "relevancerank"),
    ("price-asc", "Price: low to high", "price-asc-rank"),
    ("newest", "Newest arrivals", "date-desc-rank"),
)

POKEMON_QUERIES = (
    ("booster-box", "Booster boxes", "pokemon booster box"),
    ("etb", "Elite Trainer Boxes", "pokemon elite trainer box"),
    ("tin", "Tins", "pokemon tin"),
    ("booster-pack", "Booster packs", "pokemon booster pack"),
    ("collection", "Collection boxes", "pokemon collection box"),
    ("charizard", "Charizard", "charizard pokemon card"),
)

_QUERY_STOPWORDS = {"pokemon", "pokémon", "card", "cards", "a", "the"}


def suggest(job: dict) -> list[dict]:
    if job.get("status") != "blocked":
        raise ValueError("Follow-ups are available when a job is blocked")
    base = _base_url(job)
    parent_min, parent_max = _parent_prices(job)
    parent_sort = _parent_sort(job)
    ideas: list[dict] = []
    seen_ranges: set[tuple[float | None, float | None]] = set()
    for band_id, label, band_min, band_max in PRICE_BANDS:
        clipped = _clip(band_min, band_max, parent_min, parent_max)
        if clipped is None:
            continue
        lo, hi = clipped
        if (lo, hi) == (parent_min, parent_max):
            continue
        if (lo, hi) in seen_ranges:
            continue
        seen_ranges.add((lo, hi))
        ideas.append(
            _idea(
                suggestion_id=f"price:{band_id}",
                kind="price",
                label=label,
                detail=_price_detail(lo, hi),
                url=apply_slice(base, lo, hi, parent_sort),
                min_price=lo,
                max_price=hi,
                sort=parent_sort,
            )
        )
    for sort_id, label, sort_value in SORTS:
        if sort_value == parent_sort:
            continue
        ideas.append(
            _idea(
                suggestion_id=f"sort:{sort_id}",
                kind="sort",
                label=label,
                detail="Same prices, different Amazon sort, so page 1 is a different slice.",
                url=apply_slice(base, parent_min, parent_max, sort_value),
                min_price=parent_min,
                max_price=parent_max,
                sort=sort_value,
            )
        )
    parent_query = _parent_query(job)
    if _pokemonish(job, parent_query):
        department = (job.get("settings") or {}).get("department") or "all"
        for query_id, label, keyword in POKEMON_QUERIES:
            if _query_already_used(parent_query, keyword):
                continue
            url = build_search_url(keyword, parent_min, parent_max, department)
            if parent_sort and parent_sort != "relevancerank":
                url = apply_slice(url, parent_min, parent_max, parent_sort)
            ideas.append(
                _idea(
                    suggestion_id=f"query:{query_id}",
                    kind="query",
                    label=f"Search: {label}",
                    detail=f"Narrower keyword “{keyword}”, so pagination starts on a smaller catalog.",
                    url=url,
                    min_price=parent_min,
                    max_price=parent_max,
                    sort=parent_sort,
                    query=keyword,
                )
            )
    return ideas


def materialize(job: dict, suggestion_ids: list[str], defaults: dict) -> list[dict]:
    """Build create_job kwargs for the selected suggestions. Does not insert."""
    if job.get("status") != "blocked":
        raise ValueError("Follow-ups are available when a job is blocked")
    chosen = list(suggestion_ids)
    wanted = [item for item in suggest(job) if item["id"] in set(chosen)]
    if not wanted:
        raise ValueError("Select at least one follow-up")
    unknown = set(chosen) - {item["id"] for item in wanted}
    if unknown:
        raise ValueError("Unknown follow-up selection")
    parent_settings = job.get("settings") or {}
    proxy = _proxy_for_followup(parent_settings, defaults)
    created: list[dict] = []
    base_terms = (job.get("search_terms") or job.get("search_query") or "follow-up").strip()
    for idea in wanted:
        search_query = idea.get("query") or job.get("search_query")
        mode = "search" if (search_query or "").strip() else "url"
        settings = {
            "max_pages": int(parent_settings.get("max_pages") or defaults.get("max_pages") or 3),
            "delay_ms": int(parent_settings.get("delay_ms") or int(float(defaults.get("delay_sec") or 2.5) * 1000)),
            "headless": bool(parent_settings.get("headless", defaults.get("headless", True))),
            "mode": mode,
            "min_price": idea["min_price"],
            "max_price": idea["max_price"],
            "department": parent_settings.get("department") or "all",
            "fixture_set": None,
            "sort": idea["sort"],
            "resume_url": idea["start_url"],
            "next_page_number": 1,
            "block_acknowledged": False,
            **proxy,
        }
        created.append(
            {
                "start_url": idea["start_url"],
                "search_query": search_query,
                "search_terms": f"{base_terms}|follow-up|{idea['id']}|parent:{job['id']}",
                "settings": settings,
                "parent_job_id": job["id"],
            }
        )
    return created


def _idea(
    *,
    suggestion_id: str,
    kind: str,
    label: str,
    detail: str,
    url: str,
    min_price: float | None,
    max_price: float | None,
    sort: str,
    query: str | None = None,
) -> dict:
    return {
        "id": suggestion_id,
        "kind": kind,
        "label": label,
        "detail": detail,
        "start_url": url,
        "min_price": min_price,
        "max_price": max_price,
        "sort": sort,
        "query": query,
    }


def _base_url(job: dict) -> str:
    start = (job.get("start_url") or "").strip()
    if start.startswith("http://") or start.startswith("https://"):
        return validate_amazon_url(start)
    query = (job.get("search_query") or "").strip()
    if not query:
        raise ValueError("This job has no search keyword or Amazon URL to slice")
    settings = job.get("settings") or {}
    return build_search_url(
        query,
        settings.get("min_price"),
        settings.get("max_price"),
        settings.get("department") or "all",
    )


def _parent_prices(job: dict) -> tuple[float | None, float | None]:
    settings = job.get("settings") or {}
    minimum = settings.get("min_price")
    maximum = settings.get("max_price")
    if minimum is None and maximum is None:
        parsed = price_bounds_from_url(job.get("start_url") or "")
        if parsed is not None:
            return parsed
    return _as_price(minimum), _as_price(maximum)


def _parent_sort(job: dict) -> str:
    start = job.get("start_url") or ""
    if start.startswith("http://") or start.startswith("https://"):
        return sort_from_url(start)
    stored = (job.get("settings") or {}).get("sort")
    return stored or "relevancerank"


def _clip(
    band_min: float | None,
    band_max: float | None,
    parent_min: float | None,
    parent_max: float | None,
) -> tuple[float | None, float | None] | None:
    lo = 0.0 if band_min is None else band_min
    hi = float("inf") if band_max is None else band_max
    plo = 0.0 if parent_min is None else parent_min
    phi = float("inf") if parent_max is None else parent_max
    if lo >= phi or hi <= plo:
        return None
    clipped_lo = lo if parent_min is None else max(lo, plo)
    clipped_hi = hi if parent_max is None else min(hi, phi)
    if clipped_lo >= clipped_hi:
        return None
    out_lo = None if clipped_lo <= 0 else clipped_lo
    out_hi = None if clipped_hi == float("inf") else clipped_hi
    return out_lo, out_hi


def _price_detail(minimum: float | None, maximum: float | None) -> str:
    if minimum is None and maximum is not None:
        span = f"under ${ _dollars(maximum) }"
    elif minimum is not None and maximum is None:
        span = f"${ _dollars(minimum) } and up"
    elif minimum is not None and maximum is not None:
        span = f"${ _dollars(minimum) }–${ _dollars(maximum) }"
    else:
        span = "the same prices"
    return f"Same search, limited to {span}, so pagination starts over in that slice."


def _dollars(value: float) -> str:
    if float(value).is_integer():
        return str(int(value))
    return f"{value:.2f}"


def _as_price(value) -> float | None:
    if value is None or value == "":
        return None
    return float(value)


def _proxy_for_followup(parent_settings: dict, defaults: dict) -> dict:
    if parent_settings.get("mode") == "fixture":
        if defaults.get("proxy_enabled") and (defaults.get("proxy_url") or "").strip():
            return {
                "proxy_enabled": True,
                "proxy_url": str(defaults.get("proxy_url") or "").strip(),
                "proxy_username": defaults.get("proxy_username") or "",
                "proxy_password": defaults.get("proxy_password") or "",
            }
        return _proxy_off()
    if parent_settings.get("proxy_enabled") and (parent_settings.get("proxy_url") or "").strip():
        return {
            "proxy_enabled": True,
            "proxy_url": str(parent_settings.get("proxy_url") or "").strip(),
            "proxy_username": parent_settings.get("proxy_username") or "",
            "proxy_password": parent_settings.get("proxy_password") or "",
        }
    return _proxy_off()


def _parent_query(job: dict) -> str:
    query = (job.get("search_query") or "").strip()
    if query:
        return query
    start = job.get("start_url") or ""
    if start.startswith("http://") or start.startswith("https://"):
        for key, value in parse_qsl(urlparse(start).query, keep_blank_values=True):
            if key == "k" and value.strip():
                return value.strip()
    return ""


def _pokemonish(job: dict, query: str) -> bool:
    blob = " ".join(
        [
            query,
            job.get("search_terms") or "",
            job.get("start_url") or "",
        ]
    ).lower()
    return "pokemon" in blob or "pokémon" in blob or "charizard" in blob


def _query_already_used(parent: str, narrow: str) -> bool:
    parent_words = set(re.sub(r"[^a-z0-9]+", " ", parent.lower()).split())
    narrow_words = [
        word
        for word in re.sub(r"[^a-z0-9]+", " ", narrow.lower()).split()
        if word not in _QUERY_STOPWORDS
    ]
    return bool(narrow_words) and all(word in parent_words for word in narrow_words)


def _proxy_off() -> dict:
    return {
        "proxy_enabled": False,
        "proxy_url": "",
        "proxy_username": "",
        "proxy_password": "",
    }

