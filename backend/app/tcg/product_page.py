"""Read one TCGPlayer product page. Missing fields stay empty; nothing is invented."""

from __future__ import annotations

import re

from bs4 import BeautifulSoup

from app.tcg.search import _price, page_is_blocked, _prices


class ProductPageError(ValueError):
    """The page was blocked or did not contain the fields a manual match needs."""


def tcg_product_fixture(
    *,
    name: str = "Scarlet &amp; Violet Booster Box",
    set_name: str = "Scarlet &amp; Violet",
    product_id: str = "1001",
    market: str = "139.99",
    low: str = "129.00",
    image: str = "https://tcgplayer.example/images/1001.jpg",
) -> str:
    return (
        "<html><body>"
        f'<main class="tcg-product" data-product-id="{product_id}">'
        f'<h1 class="tcg-product-title">{name}</h1>'
        f'<div class="tcg-product-set">{set_name}</div>'
        f'<img class="tcg-product-image" src="{image}" alt="" />'
        f'<span class="tcg-price" data-price-label="Market">${market}</span>'
        f'<span class="tcg-price" data-price-label="Low">${low}</span>'
        "</main></body></html>"
    )


def parse_tcg_product_page(html: str, page_url: str, *, status: int | None = None) -> dict:
    if page_is_blocked(html, status):
        raise ProductPageError("TCGPlayer blocked this page. Nothing was saved.")
    soup = BeautifulSoup(html or "", "html.parser")
    _reject_different_product(soup, page_url)
    title_node = (
        soup.select_one("h1.tcg-product-title")
        or soup.select_one(".product-details__name")
        or soup.select_one("h1")
    )
    name = " ".join(title_node.get_text(" ", strip=True).split()) if title_node else ""
    if len(name) < 2:
        raise ProductPageError("Could not read the product name from this TCGPlayer page.")
    set_node = soup.select_one(".tcg-product-set") or soup.select_one(".product-details__name__sub-header")
    set_name = " ".join(set_node.get_text(" ", strip=True).split()) if set_node else ""
    prices = _product_prices(soup)
    market = _labeled(prices, "market")
    low = _labeled(prices, "low") or _labeled(prices, "listed")
    if market is None and low is None:
        raise ProductPageError(
            "Could not read a Market, Low, or Listed price from this TCGPlayer page."
        )
    primary = market or low
    image = soup.select_one("img.tcg-product-image") or soup.select_one(".product-details img")
    image_url = ""
    if image is not None:
        image_url = (image.get("src") or image.get("data-src") or "").strip()
    kept = [item for item in prices if str(item.get("label") or "").lower() in {"market", "low", "listed", "mid", "high"}]
    return {
        "name": name,
        "set_name": set_name or None,
        "url": page_url,
        "image_url": image_url or None,
        "prices": kept,
        "price": primary["amount"],
        "price_label": primary["label"],
        "currency": "USD",
    }


def _product_prices(soup: BeautifulSoup) -> list[dict]:
    guide = soup.select_one(".product-details__price-guide") or soup.select_one(".price-guide__points")
    if guide is not None:
        found = _table_prices(guide)
        if found:
            return found
        return _prices(guide)
    fixture = soup.select_one("main.tcg-product") or soup.select_one(".tcg-product")
    if fixture is not None:
        return _prices(fixture)
    return []


def _table_prices(node) -> list[dict]:
    found: list[dict] = []
    seen: set[tuple[str, float]] = set()
    for row in node.select("tr"):
        cells = row.find_all("td")
        if len(cells) < 2:
            continue
        raw_label = " ".join(cells[0].get_text(" ", strip=True).split())
        amount = _price(cells[1].get_text(" ", strip=True))
        if amount is None:
            continue
        label = _canon_label(raw_label)
        if label is None:
            continue
        key = (label.lower(), amount)
        if key in seen:
            continue
        seen.add(key)
        found.append({"label": label, "amount": amount})
    return found


def _canon_label(text: str) -> str | None:
    low = " ".join(text.lower().split())
    if low in {"market price", "market"}:
        return "Market"
    if low in {"low", "low price"}:
        return "Low"
    if low in {"listed", "listed price"}:
        return "Listed"
    if low in {"mid", "mid price"}:
        return "Mid"
    if low in {"high", "high price"}:
        return "High"
    return None


def _reject_different_product(soup: BeautifulSoup, page_url: str) -> None:
    match = re.search(r"/product/(\d+)", page_url or "")
    if match is None:
        return
    expected = match.group(1)
    images = soup.select(".product-details img") or soup.select("img.tcg-product-image")
    for image in images:
        src = image.get("src") or ""
        found = re.search(r"/product/(\d+)", src)
        if found is None:
            continue
        if found.group(1) != expected:
            raise ProductPageError(
                f"This TCGPlayer page is for product {found.group(1)}, not {expected}. Nothing was saved."
            )
        return


def _labeled(prices: list[dict], label: str) -> dict | None:
    for item in prices:
        if str(item.get("label") or "").lower() == label:
            return item
    return None
