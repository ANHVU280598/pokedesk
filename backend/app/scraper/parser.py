"""Parse Amazon search-result HTML into cards and a pagination hint.

The same parser runs on live Playwright pages and on saved fixtures.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from urllib.parse import urljoin

from bs4 import BeautifulSoup

ASIN_RE = re.compile(r"^[A-Z0-9]{10}$")
MONEY_RE = re.compile(
    r"([$£€])\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?|[0-9]+(?:\.[0-9]{2})?)"
)
RATING_RE = re.compile(r"([0-9]+(?:\.[0-9]+)?)\s+out of\s+5", re.IGNORECASE)
REVIEWS_RE = re.compile(
    r"([0-9][0-9,]*(?:\.[0-9]+)?)\s*([kKmM])?\s+ratings?\b",
    re.IGNORECASE,
)
COUNT_RE = re.compile(
    r"([0-9][0-9,]*)\s*[-–—]\s*([0-9][0-9,]*)\s+of\s+(over\s+)?([0-9][0-9,]*)\+?\s+results",
    re.IGNORECASE,
)
AVAIL_RE = re.compile(
    r"(Only \d+ left in stock(?:[^.|]{0,40})?|Currently unavailable|Temporarily out of stock)",
    re.IGNORECASE,
)
SHOW_MORE_TEXT = {
    "show more",
    "show more results",
    "load more",
    "load more results",
}
CURRENCY = {"$": "USD", "£": "GBP", "€": "EUR"}


@dataclass
class Card:
    asin: str | None
    title: str
    price: float | None
    currency: str | None
    list_price: float | None
    rating: float | None
    review_count: int | None
    image_url: str | None
    product_url: str | None
    badges: list[str] = field(default_factory=list)
    seller: str | None = None
    availability_snippet: str | None = None


@dataclass
class ParseResult:
    cards: list[Card]
    pagination_mode: str
    next_url: str | None
    block_reason: str | None
    result_from: int | None
    result_to: int | None
    result_total: int | None
    result_over: bool
    breadcrumbs: str | None

    @property
    def suggests_more(self) -> bool:
        if self.block_reason:
            return False
        if self.result_over:
            return True
        if self.result_to is not None and self.result_total is not None:
            return self.result_to < self.result_total
        return False


def card_payload(card: Card, page_url: str, breadcrumbs: str | None, page_number: int) -> dict:
    return {
        "asin": card.asin,
        "title": card.title,
        "image_url": card.image_url,
        "product_url": card.product_url,
        "category_breadcrumbs": breadcrumbs,
        "price": card.price,
        "currency": card.currency,
        "list_price": card.list_price,
        "rating": card.rating,
        "review_count": card.review_count,
        "badges": list(card.badges),
        "availability_snippet": card.availability_snippet,
        "seller": card.seller,
        "page_number": page_number,
        "page_url": page_url,
    }


def parse_results(html: str, page_url: str) -> ParseResult:
    soup = BeautifulSoup(html, "html.parser")
    reason = detect_block(soup, html)
    breadcrumbs = extract_breadcrumbs(soup)
    if reason:
        return ParseResult(
            cards=[],
            pagination_mode="none",
            next_url=None,
            block_reason=reason,
            result_from=None,
            result_to=None,
            result_total=None,
            result_over=False,
            breadcrumbs=breadcrumbs,
        )
    cards = extract_cards(soup, page_url)
    mode, next_url = extract_pagination(soup, page_url)
    start, end, total, over = extract_counts(soup)
    return ParseResult(
        cards=cards,
        pagination_mode=mode,
        next_url=next_url,
        block_reason=None,
        result_from=start,
        result_to=end,
        result_total=total,
        result_over=over,
        breadcrumbs=breadcrumbs,
    )


def detect_block(soup: BeautifulSoup, html: str) -> str | None:
    lowered = html.lower()
    title = soup.title.get_text(" ", strip=True).lower() if soup.title else ""
    if (
        "validatecaptcha" in lowered
        or soup.select_one("#captchacharacters") is not None
        or "robot check" in title
        or "not a robot" in lowered
        or "automated access" in lowered
    ):
        return "Amazon served a robot check. Results already stored were kept."
    if "sorry! something went wrong" in lowered or "dogs of amazon" in lowered:
        return "Amazon returned an error page. Results already stored were kept."
    if "continue shopping" in lowered and (
        "automated" in lowered or soup.select_one("form[action*='/errors/']") is not None
    ):
        return (
            "Amazon interrupted the session with a continue-shopping check. "
            "Results already stored were kept."
        )
    return None


def extract_cards(soup: BeautifulSoup, page_url: str) -> list[Card]:
    nodes = soup.select('[data-component-type="s-search-result"]')
    if not nodes:
        nodes = soup.select("div.s-result-item[data-asin]")
    cards: list[Card] = []
    seen: set[str] = set()
    for node in nodes:
        card = parse_card(node, page_url)
        if card is None:
            continue
        key = card.asin or card.product_url or card.title
        if key in seen:
            continue
        seen.add(key)
        cards.append(card)
    return cards


_RELATED_ROOTS = (
    "#similarities_feature_div",
    "#sims-feature",
    "#sp_detail",
    "#purchase-sims-feature",
    "#anonCarousel1",
    "[data-feature-name='similarities']",
    "[data-feature-name='sims']",
    ".a-carousel-container",
    ".p13n-sc-uncoverable-faceout",
)


def parse_related_cards(html: str, page_url: str, *, skip_asin: str | None = None) -> list[Card]:
    """Best-effort related, similar, sponsored, or also-viewed cards.

    Returns an empty list when the layout has none. Does not fill in missing prices.
    """
    soup = BeautifulSoup(html, "html.parser")
    if detect_block(soup, html):
        return []
    nodes = []
    for selector in _RELATED_ROOTS:
        nodes.extend(soup.select(selector))
    cards: list[Card] = []
    seen: set[str] = set()
    skip = clean_asin(skip_asin) if skip_asin else None
    for root in nodes:
        candidates = root.select("[data-asin]")
        if not candidates and root.get("data-asin"):
            candidates = [root]
        for node in candidates:
            card = parse_card(node, page_url)
            if card is None or card.asin is None:
                continue
            if skip and card.asin == skip:
                continue
            if card.asin in seen:
                continue
            seen.add(card.asin)
            cards.append(card)
    return cards


def parse_card(node, page_url: str) -> Card | None:
    asin = clean_asin(node.get("data-asin"))
    product_url = extract_url(node, page_url)
    if asin is None and product_url:
        match = re.search(r"/(?:dp|gp/product)/([A-Z0-9]{10})", product_url, re.IGNORECASE)
        if match:
            asin = clean_asin(match.group(1))
    title = extract_title(node)
    if not title:
        return None
    price, currency, list_price = extract_price(node)
    rating, reviews = extract_rating_and_reviews(node)
    return Card(
        asin=asin,
        title=title[:500],
        price=price,
        currency=currency,
        list_price=list_price,
        rating=rating,
        review_count=reviews,
        image_url=extract_image(node),
        product_url=product_url,
        badges=extract_badges(node),
        seller=extract_seller(node),
        availability_snippet=extract_availability(node),
    )


def clean_asin(value: str | None) -> str | None:
    if not value:
        return None
    cleaned = value.strip().upper()
    if not ASIN_RE.match(cleaned):
        return None
    return cleaned


def extract_title(node) -> str:
    heading = node.select_one("h2")
    if heading is not None:
        span = heading.select_one("span")
        text = (span or heading).get_text(" ", strip=True)
        text = " ".join(text.split())
        if len(text) > 2:
            return text
    image = node.select_one("img.s-image") or node.select_one("img[alt]")
    if image is not None and image.get("alt"):
        return " ".join(image["alt"].split())
    return ""


def extract_url(node, page_url: str) -> str | None:
    anchor = node.select_one("h2 a[href]") or node.select_one("a[href*='/dp/']")
    if anchor is None:
        return None
    href = anchor.get("href") or ""
    if not href or href.startswith(("javascript:", "#")):
        return None
    return absolutize(href, page_url)


def extract_image(node) -> str | None:
    image = node.select_one("img.s-image") or node.select_one("img")
    if image is None:
        return None
    src = image.get("src") or image.get("data-src")
    if not src or src.startswith("data:"):
        return None
    return src


def extract_price(node) -> tuple[float | None, str | None, float | None]:
    price = None
    currency = None
    for block in node.select(".a-price"):
        classes = block.get("class") or []
        if "a-text-price" in classes:
            continue
        off = block.select_one(".a-offscreen")
        if off is None:
            continue
        amount, cur = parse_money(off.get_text(" ", strip=True))
        if amount is not None:
            price, currency = amount, cur
            break
    list_price = None
    for block in node.select(".a-text-price"):
        off = block.select_one(".a-offscreen")
        if off is None:
            continue
        amount, _cur = parse_money(off.get_text(" ", strip=True))
        if amount is not None:
            list_price = amount
            break
    return price, currency, list_price


def parse_money(text: str) -> tuple[float | None, str | None]:
    match = MONEY_RE.search(text.replace("\xa0", " "))
    if not match:
        return None, None
    return float(match.group(2).replace(",", "")), CURRENCY[match.group(1)]


def extract_rating_and_reviews(node) -> tuple[float | None, int | None]:
    rating = None
    reviews = None
    for el in node.select("[aria-label]"):
        label = el.get("aria-label") or ""
        if len(label) > 80:
            continue
        if rating is None:
            rating = parse_rating(label)
        if reviews is None:
            reviews = parse_reviews(label)
    if rating is None or reviews is None:
        text = node.get_text(" ", strip=True)
        if rating is None:
            rating = parse_rating(text)
        if reviews is None:
            reviews = parse_reviews(text)
    return rating, reviews


def parse_rating(text: str) -> float | None:
    match = RATING_RE.search(text.replace("\xa0", " "))
    if not match:
        return None
    value = float(match.group(1))
    if value > 5:
        return None
    return value


def parse_reviews(text: str) -> int | None:
    match = REVIEWS_RE.search(text.replace("\xa0", " "))
    if not match:
        return None
    number = float(match.group(1).replace(",", ""))
    suffix = (match.group(2) or "").lower()
    if suffix == "k":
        number *= 1000
    elif suffix == "m":
        number *= 1_000_000
    return int(round(number))


def extract_badges(node) -> list[str]:
    badges: list[str] = []
    for el in node.select(".a-badge-text, .a-badge-label"):
        text = " ".join(el.get_text(" ", strip=True).split())
        if text and text not in badges:
            badges.append(text)
    for el in node.find_all(["span", "div"]):
        if el.find_parent(["script", "style"]) is not None:
            continue
        text = " ".join(el.get_text(" ", strip=True).split())
        if text.lower() == "sponsored" and "Sponsored" not in badges:
            badges.append("Sponsored")
            break
    return badges


def extract_seller(node) -> str | None:
    for row in node.select(".a-row"):
        text = " ".join(row.get_text(" ", strip=True).split())
        match = re.match(r"^by\s+(.+)$", text, re.IGNORECASE)
        if match and 1 < len(match.group(1)) <= 80:
            return match.group(1).strip()
    return None


def extract_availability(node) -> str | None:
    match = AVAIL_RE.search(node.get_text(" ", strip=True))
    if not match:
        return None
    return match.group(1).strip()[:120]


def extract_pagination(soup: BeautifulSoup, page_url: str) -> tuple[str, str | None]:
    for anchor in soup.select("a[href]"):
        if anchor.find_parent(["script", "style"]) is not None:
            continue
        classes = " ".join(anchor.get("class") or [])
        if "s-pagination-disabled" in classes or anchor.get("aria-disabled") == "true":
            continue
        href = anchor.get("href") or ""
        if not href or href.startswith(("javascript:", "#")):
            continue
        label = anchor.get("aria-label") or ""
        is_next = "s-pagination-next" in classes or re.search(r"next page", label, re.IGNORECASE)
        if is_next:
            return "next_page", absolutize(href, page_url)
    for el in soup.find_all(["a", "button"]):
        if el.find_parent(["script", "style"]) is not None:
            continue
        text = " ".join(el.get_text(" ", strip=True).split()).lower()
        if text not in SHOW_MORE_TEXT:
            continue
        href = el.get("href") if el.name == "a" else None
        if href and not href.startswith(("javascript:", "#")):
            return "show_more", absolutize(href, page_url)
        return "show_more", None
    return "none", None


def extract_counts(soup: BeautifulSoup) -> tuple[int | None, int | None, int | None, bool]:
    match = COUNT_RE.search(soup.get_text(" ", strip=True))
    if not match:
        return None, None, None, False
    return (
        int(match.group(1).replace(",", "")),
        int(match.group(2).replace(",", "")),
        int(match.group(4).replace(",", "")),
        bool(match.group(3)),
    )


def extract_breadcrumbs(soup: BeautifulSoup) -> str | None:
    nav = soup.select_one("#wayfinding-breadcrumbs_feature_div") or soup.select_one(".a-breadcrumb")
    if nav is None:
        return None
    parts = []
    for anchor in nav.select("a"):
        text = " ".join(anchor.get_text(" ", strip=True).split())
        if text and text not in {">", "›"}:
            parts.append(text)
    if not parts:
        return None
    return " > ".join(parts)


def absolutize(href: str, page_url: str) -> str:
    if href.startswith("fixture:"):
        return href
    return urljoin(page_url, href)
