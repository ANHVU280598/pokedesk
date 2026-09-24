"""Validate the product URLs an operator pastes for a manual match."""

from __future__ import annotations

import re

_TCG = re.compile(
    r"^https?://(?:www\.)?tcgplayer\.com/product/(\d+)(?:/([A-Za-z0-9-]+))?/?$",
    re.IGNORECASE,
)
_AMAZON = re.compile(
    r"^https?://(?:www\.)?amazon\.com/(?:.*?/)?(?:dp|gp/product)/([A-Z0-9]{10})(?:/[^?#]*)?/?$",
    re.IGNORECASE,
)


class LinkError(ValueError):
    """The pasted text is not a product URL this app can scrape."""


def tcg_product_url(value: str) -> tuple[str, str]:
    """Return the canonical TCGPlayer product URL and its numeric id.

    Search pages, other hosts, and URLs without a product id are rejected.
    """
    text = _strip(value)
    match = _TCG.match(text)
    if match is None:
        raise LinkError(
            "Enter a TCGPlayer product URL, like https://www.tcgplayer.com/product/123456/card-name."
        )
    product_id = match.group(1)
    slug = match.group(2)
    if slug:
        return f"https://www.tcgplayer.com/product/{product_id}/{slug}", product_id
    return f"https://www.tcgplayer.com/product/{product_id}", product_id


def amazon_product_url(value: str) -> tuple[str, str]:
    """Return the canonical amazon.com product URL and its ASIN."""
    text = _strip(value)
    match = _AMAZON.match(text)
    if match is None:
        raise LinkError(
            "Enter an amazon.com product URL, like https://www.amazon.com/dp/B0PKMN0001."
        )
    asin = match.group(1).upper()
    return f"https://www.amazon.com/dp/{asin}", asin


def _strip(value: str) -> str:
    text = (value or "").strip()
    text = text.split("#", 1)[0].split("?", 1)[0].strip()
    return text
