"""Turn an API request into a scrape_jobs row."""

from __future__ import annotations

from app.scraper.urls import DEPARTMENTS, build_search_url, validate_amazon_url
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
    }
    return {
        "start_url": start_url,
        "search_query": search_query,
        "search_terms": search_terms,
        "settings": settings,
    }


def clean_settings(body: SettingsUpdate) -> dict:
    return {
        "delay_sec": float(body.delay_sec),
        "max_pages": int(body.max_pages),
        "headless": bool(body.headless),
    }


def retry_wait_seconds(settings: dict) -> float:
    if settings.get("mode") == "fixture":
        return 0
    delay = float(settings.get("delay_ms") or 0) / 1000
    return max(8.0, delay)
