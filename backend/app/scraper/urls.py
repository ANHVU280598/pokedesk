"""Amazon URL checks and search-url construction."""

from __future__ import annotations

import re
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

AMAZON_HOST = re.compile(
    r"^(?:www\.)?amazon\.(?:com|co\.uk|ca|de|fr|it|es|co\.jp|com\.mx|com\.au|in)$",
    re.IGNORECASE,
)
PRODUCT_PATH = re.compile(r"/(?:dp|gp/product|gp/aw/d)/", re.IGNORECASE)

DEPARTMENTS = {
    "all": None,
    "toys-and-games": "toys-and-games",
    "stripbooks": "stripbooks",
    "videogames": "videogames",
    "sporting": "sporting",
}


def validate_amazon_url(url: str) -> str:
    cleaned = url.strip()
    parsed = urlparse(cleaned)
    if parsed.scheme not in {"http", "https"}:
        raise ValueError("URL must start with http or https")
    host = parsed.hostname or ""
    if not AMAZON_HOST.match(host):
        raise ValueError("Only Amazon results URLs are accepted")
    if PRODUCT_PATH.search(parsed.path or ""):
        raise ValueError("Paste a search or category results URL, not a product page")
    return cleaned


def build_search_url(
    query: str,
    min_price: float | None,
    max_price: float | None,
    department: str | None,
) -> str:
    params: dict[str, str] = {"k": query.strip()}
    dept = DEPARTMENTS.get(department or "all")
    if dept:
        params["i"] = dept
    if min_price is not None or max_price is not None:
        lo = 0 if min_price is None else int(round(min_price * 100))
        hi = 100_000_000 if max_price is None else int(round(max_price * 100))
        params["rh"] = f"p_36:{lo}-{hi}"
    return "https://www.amazon.com/s?" + urlencode(params)


OPEN_HI_CENTS = 100_000_000


def price_bounds_from_url(url: str) -> tuple[float | None, float | None] | None:
    parsed = urlparse(url or "")
    for key, value in parse_qsl(parsed.query, keep_blank_values=True):
        if key != "rh":
            continue
        for part in value.split(","):
            if not part.startswith("p_36:"):
                continue
            span = part.split(":", 1)[1]
            if "-" not in span:
                continue
            lo_s, hi_s = span.split("-", 1)
            try:
                lo = int(lo_s) / 100
                hi = int(hi_s) / 100
            except ValueError:
                return None
            return (
                None if lo <= 0 else lo,
                None if hi >= OPEN_HI_CENTS / 100 else hi,
            )
    return None


def sort_from_url(url: str) -> str:
    parsed = urlparse(url or "")
    for key, value in parse_qsl(parsed.query, keep_blank_values=True):
        if key == "s" and value:
            return value
    return "relevancerank"


def apply_slice(
    url: str,
    min_price: float | None,
    max_price: float | None,
    sort: str | None,
) -> str:
    """Replace the price refinement and sort on an Amazon results URL."""
    parsed = urlparse(url)
    kept: list[tuple[str, str]] = []
    rh_parts: list[str] = []
    for key, value in parse_qsl(parsed.query, keep_blank_values=True):
        if key == "s":
            continue
        if key == "rh":
            for part in value.split(","):
                if part and not part.startswith("p_36:"):
                    rh_parts.append(part)
            continue
        kept.append((key, value))
    if min_price is not None or max_price is not None:
        lo = 0 if min_price is None else int(round(float(min_price) * 100))
        hi = OPEN_HI_CENTS if max_price is None else int(round(float(max_price) * 100))
        if lo > hi:
            raise ValueError("Price band is empty")
        rh_parts.append(f"p_36:{lo}-{hi}")
    if rh_parts:
        kept.append(("rh", ",".join(rh_parts)))
    if sort and sort != "relevancerank":
        kept.append(("s", sort))
    return urlunparse(parsed._replace(query=urlencode(kept)))
