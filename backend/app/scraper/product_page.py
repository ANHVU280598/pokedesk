"""Read one Amazon product page. Prices come only from the main price box."""

from __future__ import annotations

from bs4 import BeautifulSoup

from app.scraper.parser import CURRENCY, MONEY_RE, clean_asin, detect_block


class ProductPageError(ValueError):
    """The page was blocked or did not contain the fields a manual match needs."""


def amazon_product_fixture(
    *,
    title: str = "Pokemon TCG: Scarlet &amp; Violet Booster Box",
    asin: str = "B0PKMN0001",
    price: str = "143.99",
    list_price: str = "159.99",
    image: str = "https://amazon.example/booster.jpg",
) -> str:
    return (
        "<html><body><div id=\"dp\">"
        f'<span id="productTitle">{title}</span>'
        f'<input type="hidden" id="ASIN" value="{asin}" />'
        f'<img id="landingImage" src="{image}" alt="" />'
        '<div id="corePriceDisplay_desktop_feature_div">'
        f'<span class="a-price"><span class="a-offscreen">${price}</span></span>'
        f'<span class="a-price a-text-price"><span class="a-offscreen">${list_price}</span></span>'
        "</div></div></body></html>"
    )


def parse_amazon_product_page(html: str, page_url: str, *, asin: str) -> dict:
    soup = BeautifulSoup(html or "", "html.parser")
    reason = detect_block(soup, html or "")
    if reason:
        raise ProductPageError(f"Amazon blocked this page. Nothing was saved. {reason}")
    expected = clean_asin(asin)
    if expected is None:
        raise ProductPageError("That Amazon URL does not include a product ASIN.")
    page_asin = clean_asin(_value(soup.select_one("#ASIN")) or _value(soup.select_one("input[name='ASIN']")))
    if page_asin and page_asin != expected:
        raise ProductPageError(
            f"This Amazon page is for {page_asin}, not {expected}. Nothing was saved."
        )
    title_node = soup.select_one("#productTitle")
    title = " ".join(title_node.get_text(" ", strip=True).split()) if title_node else ""
    if len(title) < 2:
        raise ProductPageError("Could not read the product title from this Amazon page.")
    box = (
        soup.select_one("#corePriceDisplay_desktop_feature_div")
        or soup.select_one("#corePrice_feature_div")
        or soup.select_one("#apex_desktop")
    )
    if box is None:
        raise ProductPageError("Could not read the price from this Amazon page.")
    sale = box.select_one(".a-price:not(.a-text-price) .a-offscreen")
    amount, currency = _money(sale.get_text(" ", strip=True) if sale else "")
    if amount is None:
        raise ProductPageError("Could not read the price from this Amazon page.")
    struck = box.select_one(".a-price.a-text-price .a-offscreen")
    list_amount, _list_currency = _money(struck.get_text(" ", strip=True) if struck else "")
    if list_amount == amount:
        list_amount = None
    image = soup.select_one("#landingImage") or soup.select_one("#imgBlkFront")
    image_url = ""
    if image is not None:
        image_url = (image.get("data-old-hires") or image.get("src") or "").strip()
    return {
        "asin": expected,
        "title": title,
        "image_url": image_url or None,
        "product_url": page_url,
        "category_breadcrumbs": None,
        "price": amount,
        "currency": currency,
        "list_price": list_amount,
        "rating": None,
        "review_count": None,
        "bought_past_month": None,
        "bought_past_month_text": None,
        "badges": [],
        "availability_snippet": None,
        "seller": None,
        "page_number": 1,
        "source": "results",
    }


def _value(node) -> str:
    if node is None:
        return ""
    return str(node.get("value") or "")


def _money(text: str) -> tuple[float | None, str | None]:
    match = MONEY_RE.search(text or "")
    if match is None:
        return None, None
    try:
        amount = float(match.group(2).replace(",", ""))
    except ValueError:
        return None, None
    return amount, CURRENCY.get(match.group(1), "USD")
