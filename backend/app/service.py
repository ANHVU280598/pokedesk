"""Turn an API request into a scrape_jobs row."""

from __future__ import annotations

from urllib.parse import urlparse

from app.scraper.fixtures import BUNDLES
from app.scraper.urls import DEPARTMENTS, build_search_url, validate_amazon_url, with_page
from app.schemas import JobCreate, SettingsUpdate

FIXTURE_SETS = {"pokemon", "captcha", "pagecap", "showmore"}
MAX_PAGES = 20
MIN_LIVE_DELAY = 1.0
MAX_DELAY = 60.0


def compose_new_job(body: JobCreate, defaults: dict) -> dict:
    max_pages = defaults["max_pages"] if body.max_pages is None else body.max_pages
    if not 1 <= int(max_pages) <= MAX_PAGES:
        raise ValueError(f"Max pages must be between 1 and {MAX_PAGES}")
    delay_sec = float(defaults["delay_sec"] if body.delay_sec is None else body.delay_sec)
    if body.mode == "fixture":
        if delay_sec < 0 or delay_sec > MAX_DELAY:
            raise ValueError("Delay must be between 0 and 60 seconds")
    elif delay_sec < MIN_LIVE_DELAY or delay_sec > MAX_DELAY:
        raise ValueError("Delay must be between 1 and 60 seconds for Amazon scrapes")

    if body.min_price is not None and body.min_price < 0:
        raise ValueError("Min price cannot be negative")
    if body.max_price is not None and body.max_price < 0:
        raise ValueError("Max price cannot be negative")
    if (
        body.min_price is not None
        and body.max_price is not None
        and body.min_price > body.max_price
    ):
        raise ValueError("Min price cannot exceed max price")

    department = body.department or "all"
    if department not in DEPARTMENTS:
        raise ValueError("Unknown department")

    headless = defaults["headless"] if body.headless is None else body.headless
    fixture_set = None
    if body.mode == "url":
        if not body.start_url or not body.start_url.strip():
            raise ValueError("Paste an Amazon results URL")
        start_url = validate_amazon_url(body.start_url)
        search_query = None
        search_terms = None
    elif body.mode == "search":
        query = (body.search_query or "").strip()
        if not query:
            raise ValueError("Enter a search keyword")
        if len(query) > 200:
            raise ValueError("Keyword is too long")
        start_url = build_search_url(query, body.min_price, body.max_price, department)
        search_query = query
        search_terms = (body.search_terms or query).strip() or query
    elif body.mode == "fixture":
        fixture_set = body.fixture_set or "pokemon"
        if fixture_set not in FIXTURE_SETS:
            raise ValueError("Unknown fixture set")
        start_url = f"fixture://{fixture_set}/1"
        search_query = (body.search_query or "Pokemon cards").strip()
        search_terms = (body.search_terms or "pokemon cards|fixture").strip()
    else:
        raise ValueError("Unknown mode")

    settings = {
        "max_pages": int(max_pages),
        "delay_ms": int(round(delay_sec * 1000)),
        "headless": bool(headless),
        "mode": body.mode,
        "min_price": body.min_price,
        "max_price": body.max_price,
        "department": department,
        "fixture_set": fixture_set,
        "resume_url": start_url,
        "next_page_number": 1,
        "block_acknowledged": False,
        **resolve_job_proxy(body, defaults),
    }
    return {
        "start_url": start_url,
        "search_query": search_query,
        "search_terms": search_terms,
        "settings": settings,
    }


def clean_settings(body: SettingsUpdate, current: dict) -> dict:
    url = (body.proxy_url or "").strip()
    if body.proxy_enabled and not url:
        raise ValueError("Enter a proxy URL, or turn the proxy off")
    if url:
        validate_proxy_url(url)
    if body.clear_proxy_password:
        password = ""
    elif (body.proxy_password or "").strip():
        password = body.proxy_password
    else:
        password = current.get("proxy_password") or ""
    return {
        "delay_sec": float(body.delay_sec),
        "max_pages": int(body.max_pages),
        "headless": bool(body.headless),
        "proxy_enabled": bool(body.proxy_enabled),
        "proxy_url": url,
        "proxy_username": (body.proxy_username or "").strip(),
        "proxy_password": password,
    }


def resolve_job_proxy(body: JobCreate, defaults: dict) -> dict:
    if body.mode == "fixture" or body.proxy_mode == "off":
        return _proxy_off()
    if body.proxy_mode == "custom":
        url = (body.proxy_url or "").strip()
        if not url:
            raise ValueError("Enter a proxy URL, or use the settings default")
        validate_proxy_url(url)
        password = body.proxy_password or ""
        username = body.proxy_username if body.proxy_username is not None else ""
        if not password and url == (defaults.get("proxy_url") or "").strip():
            password = defaults.get("proxy_password") or ""
        if not username and url == (defaults.get("proxy_url") or "").strip():
            username = defaults.get("proxy_username") or ""
        return {
            "proxy_enabled": True,
            "proxy_url": url,
            "proxy_username": username.strip(),
            "proxy_password": password,
        }
    if defaults.get("proxy_enabled") and (defaults.get("proxy_url") or "").strip():
        return {
            "proxy_enabled": True,
            "proxy_url": str(defaults.get("proxy_url") or "").strip(),
            "proxy_username": defaults.get("proxy_username") or "",
            "proxy_password": defaults.get("proxy_password") or "",
        }
    return _proxy_off()


def playwright_proxy(settings: dict) -> dict | None:
    """Proxy dict for Chromium. Fixture jobs never use one."""
    if settings.get("mode") == "fixture" or str(settings.get("resume_url") or "").startswith("fixture:"):
        return None
    if not settings.get("proxy_enabled"):
        return None
    raw = (settings.get("proxy_url") or "").strip()
    if not raw:
        return None
    parsed = urlparse(raw)
    if not parsed.hostname or parsed.scheme not in {"http", "https", "socks5"}:
        return None
    port = f":{parsed.port}" if parsed.port else ""
    config: dict[str, str] = {"server": f"{parsed.scheme}://{parsed.hostname}{port}"}
    username = settings.get("proxy_username") or parsed.username or ""
    password = settings.get("proxy_password") or parsed.password or ""
    if username:
        config["username"] = username
    if password:
        config["password"] = password
    return config


def validate_proxy_url(url: str) -> str:
    parsed = urlparse(url.strip())
    if parsed.scheme not in {"http", "https", "socks5"}:
        raise ValueError("Proxy URL must start with http://, https://, or socks5://")
    if not parsed.hostname:
        raise ValueError("Proxy URL needs a host")
    return url.strip()


def _proxy_off() -> dict:
    return {
        "proxy_enabled": False,
        "proxy_url": "",
        "proxy_username": "",
        "proxy_password": "",
    }


def retry_wait_seconds(settings: dict) -> float:
    if settings.get("mode") == "fixture":
        return 0
    delay = float(settings.get("delay_ms") or 0) / 1000
    return max(8.0, delay)


def recheck_patch(job: dict, mode: str) -> dict:
    """Where a blocked job should open next.

    `continue` asks for the next results page when that URL can be built.
    Otherwise, and for `reload`, it opens the same results list again.
    """
    settings = job.get("settings") or {}
    pages = int(job.get("pages_visited") or 0)
    start = (job.get("start_url") or "").strip()
    resume = (settings.get("resume_url") or start).strip()
    chosen = "reload"
    target = start or resume
    next_number = 1 if start else max(pages, 1)
    if mode == "continue":
        continued = _continue_url(job, resume or start, pages)
        if continued:
            chosen = "continue"
            target = continued
            next_number = pages + 1
        else:
            target = resume or start
            next_number = max(pages, 1)
    return {
        "resume_url": target,
        "next_page_number": next_number,
        "recheck_mode": chosen,
        "recheck_pages_before": pages,
        "recheck_items_before": int(job.get("items_scraped") or 0),
        "recheck_outcome": None,
        "recheck_pending": False,
        "block_acknowledged": False,
    }


def recheck_result_message(
    *,
    advanced: bool,
    blocked: bool,
    pages: int,
    base: str | None,
) -> tuple[str, str]:
    extra = f" {base}" if base else ""
    if advanced and not blocked:
        return (
            f"More pages were available. Recheck scraped through page {pages}. Earlier results were kept.",
            "advanced",
        )
    if advanced and blocked:
        return (
            "More pages were available "
            f"(through page {pages}), then the list stopped again. "
            f"Stored results were kept.{extra} Try another round of follow-up slices.",
            "advanced",
        )
    if base and "capped" in base.lower():
        lead = "Still capped after a fresh load of this results list."
    else:
        lead = "No extra page was available after reloading this results list."
    return (
        f"{lead} Stored results were kept.{extra} Try another round of follow-up slices.",
        "unchanged",
    )


def _continue_url(job: dict, url: str, pages: int) -> str | None:
    if url.startswith("fixture:"):
        bundle = (job.get("settings") or {}).get("fixture_set") or _fixture_bundle(url)
        nxt = pages + 1
        if bundle and nxt in BUNDLES.get(bundle, {}):
            return f"fixture://{bundle}/{nxt}"
        return None
    if url.startswith("http://") or url.startswith("https://"):
        return with_page(url, pages + 1)
    return None


def _fixture_bundle(url: str) -> str | None:
    # fixture://pagecap/1
    body = url[len("fixture://") :]
    name = body.split("/", 1)[0]
    return name or None
