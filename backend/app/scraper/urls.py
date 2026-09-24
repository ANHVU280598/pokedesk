"""Amazon URL checks and search-url construction."""

from __future__ import annotations

import re
from urllib.parse import urlencode, urlparse

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
