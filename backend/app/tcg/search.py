"""Build a TCGPlayer query from an Amazon title and pick a best-effort hit.

An empty search, or a hit that does not share a distinctive name token with
the Amazon title, stays unmatched. Nothing here invents a listing.

Live search reads the public JSON document the TCGPlayer results page requests.
A JavaScript shell, or any body that is not that document, is not an empty
search.
"""

from __future__ import annotations

import json
import re
from urllib.parse import quote_plus, urljoin

from bs4 import BeautifulSoup

_NOISE = re.compile(
    r"\b(?:pok[eé]mon|pokemon|tcg|trading\s+card\s+game|amazon'?s\s+choice|"
    r"best\s+seller|sponsored|sealed|official|restock|brand\s+new|"
    r"factory\s+sealed)\b",
    re.IGNORECASE,
)
_PACKS = re.compile(r"\b\d+\s*[- ]?\s*packs?\b", re.IGNORECASE)
_TOKEN = re.compile(r"[a-z0-9]+")
_MONEY = re.compile(r"\$\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?|[0-9]+(?:\.[0-9]{2})?)")
_STOP = {
    "a",
    "an",
    "and",
    "the",
    "of",
    "for",
    "with",
    "card",
    "cards",
    "game",
    "trading",
}
_GENERIC = {
    "sleeve",
    "sleeves",
    "tin",
    "box",
    "pack",
    "packs",
    "collection",
    "bundle",
    "set",
    "booster",
    "elite",
    "trainer",
    "ex",
    "upc",
    "etb",
}
_BASE = "https://www.tcgplayer.com"
_CATALOG = "https://mp-search-api.tcgplayer.com/v1/search/request"
SHELL_MESSAGE = "TCGPlayer search returned no results page"
TCG_READY = (
    "article.tcg-result, a[href*='/product/'], "
    "#challenge-running, form[action*='challenge'], .cf-error-details"
)
_RESULTS_HEADING = re.compile(r"\b\d+\s+results?\s+for\b", re.IGNORECASE)
_CATALOG_BODY = {
    "algorithm": "sales_dismax",
    "from": 0,
    "size": 24,
    "filters": {"term": {"productLineName": ["pokemon"]}, "range": {}, "match": {}},
    "listingSearch": {
        "context": {"cart": {"packages": {}}},
        "filters": {
            "term": {"sellerStatus": "Live", "channelId": 0},
            "range": {"quantity": {"gte": 1}},
            "exclude": {"channelExclusion": 0},
        },
    },
    "context": {"cart": {"packages": {}}, "shippingCountry": "US", "userProfile": {}},
    "settings": {"useFuzzySearch": True, "didYouMean": {}},
    "sort": {},
}


def search_query(title: str) -> str:
    text = _NOISE.sub(" ", title or "")
    text = _PACKS.sub(" ", text)
    text = text.replace("&", " ")
    text = re.sub(r"[^A-Za-z0-9]+", " ", text)
    text = " ".join(text.split())
    if not text:
        text = " ".join((title or "").split())
    return text[:120]


def search_url(query: str) -> str:
    return (
        "https://www.tcgplayer.com/search/pokemon/product"
        f"?productLineName=pokemon&view=grid&q={quote_plus(query)}"
    )


def catalog_request(query: str) -> tuple[str, str, dict[str, str]]:
    """The POST the results page sends. No login cookie is required."""
    url = f"{_CATALOG}?q={quote_plus(query)}&isList=false"
    payload = json.dumps(_CATALOG_BODY, separators=(",", ":"))
    headers = {
        "accept": "application/json, text/plain, */*",
        "content-type": "application/json",
        "origin": _BASE,
        "referer": search_url(query),
    }
    return url, payload, headers


def read_match_input(body: str, *, catalog: bool) -> list[dict] | None:
    """Return hits, an empty list, or None when the body is not a results page.

    None means the caller should store an error. An empty list is a real
    search that listed nothing. Fixture HTML stays on the empty-list path.
    """
    text = body or ""
    if catalog:
        return _hits_from_catalog(text)
    if _html_is_shell(text):
        return None
    return parse_results(text)


def tokens(text: str) -> list[str]:
    return [word for word in _TOKEN.findall((text or "").lower()) if word not in _STOP and len(word) > 1]


def page_is_blocked(html: str, status: int | None) -> bool:
    if status in {403, 429, 503}:
        return True
    low = (html or "").lower()
    if "cf-error-details" in low or "challenge-running" in low:
        return True
    if "verify you are human" in low or "attention required" in low:
        return True
    if "captcha" in low and ("validatecaptcha" in low or "g-recaptcha" in low):
        return True
    return False


def parse_results(html: str) -> list[dict]:
    soup = BeautifulSoup(html or "", "html.parser")
    hits: list[dict] = []
    seen: set[str] = set()
    articles = soup.select("article.tcg-result")
    if articles:
        for article in articles:
            hit = _from_article(article)
            if hit and hit["url"] not in seen:
                seen.add(hit["url"])
                hits.append(hit)
        return hits[:8]
    for link in soup.select("a[href*='/product/']"):
        hit = _from_link(link)
        if hit and hit["url"] not in seen:
            seen.add(hit["url"])
            hits.append(hit)
        if len(hits) >= 8:
            break
    return hits


def choose_match(query: str, hits: list[dict]) -> dict:
    """Pick plausible TCGPlayer listings. One strong hit is proposed; several wait for confirm."""
    query_tokens = tokens(query)
    plausible: list[dict] = []
    for hit in hits:
        score, is_plausible, strong = _judge(query_tokens, hit)
        if not is_plausible:
            continue
        plausible.append({**hit, "confidence": round(score, 2), "strong": strong})
    plausible.sort(key=lambda item: item["confidence"], reverse=True)
    if not plausible:
        return _unmatched(query, result_count=len(hits))
    strong_hits = [item for item in plausible if item["strong"]]
    if len(plausible) == 1 and strong_hits:
        return _decision(query, plausible[0], plausible, status="matched", result_count=len(hits))
    return _decision(query, None, plausible, status="needs_confirm", result_count=len(hits))


def _overlap(query_tokens: list[str], hit_tokens: list[str]) -> float:
    if not query_tokens or not hit_tokens:
        return 0.0
    shared = set(query_tokens) & set(hit_tokens)
    return len(shared) / len(set(query_tokens))


def _judge(query_tokens: list[str], hit: dict) -> tuple[float, bool, bool]:
    if not query_tokens:
        return 0.0, False, False
    name = f"{hit.get('name') or ''} {hit.get('set_name') or ''}"
    score = _overlap(query_tokens, tokens(name))
    shared = set(query_tokens) & set(tokens(hit.get("name") or ""))
    distinctive = shared - _GENERIC
    strong = score >= 0.75 and bool(distinctive)
    plausible = strong or (score >= 0.5 and bool(distinctive)) or (score >= 0.75 and bool(shared))
    if score < 0.5:
        return score, False, False
    return score, plausible, strong


def _decision(query: str, chosen: dict | None, candidates: list[dict], *, status: str, result_count: int) -> dict:
    return {
        "query": query,
        "status": status,
        "tcg_url": None if chosen is None else chosen.get("url"),
        "tcg_name": None if chosen is None else chosen.get("name"),
        "tcg_set": None if chosen is None else chosen.get("set_name"),
        "image_url": None if chosen is None else chosen.get("image_url"),
        "price": None if chosen is None else chosen.get("price"),
        "price_label": None if chosen is None else chosen.get("price_label"),
        "currency": None if chosen is None else (chosen.get("currency") or "USD"),
        "confidence": 0.0 if chosen is None else chosen.get("confidence") or 0.0,
        "candidates": [
            {key: value for key, value in item.items() if key != "strong"} for item in candidates
        ],
        "raw": {"result_count": result_count, "candidate_count": len(candidates)},
    }


def _unmatched(query: str, result_count: int = 0) -> dict:
    return {
        "query": query,
        "status": "unmatched",
        "tcg_url": None,
        "tcg_name": None,
        "tcg_set": None,
        "image_url": None,
        "price": None,
        "price_label": None,
        "currency": None,
        "confidence": 0.0,
        "candidates": [],
        "raw": {"result_count": result_count, "candidate_count": 0},
    }


def _hits_from_catalog(body: str) -> list[dict] | None:
    try:
        data = json.loads(body)
    except json.JSONDecodeError:
        return None
    if not isinstance(data, dict):
        return None
    buckets = data.get("results")
    if not isinstance(buckets, list) or not buckets or not isinstance(buckets[0], dict):
        return None
    bucket = buckets[0]
    items = bucket.get("results")
    if not isinstance(items, list):
        return None
    hits: list[dict] = []
    seen: set[str] = set()
    for item in items:
        hit = _from_catalog_item(item)
        if hit is None or hit["url"] in seen:
            continue
        seen.add(hit["url"])
        hits.append(hit)
        if len(hits) >= 8:
            break
    total = bucket.get("totalResults")
    if total and not hits:
        return None
    return hits


def _from_catalog_item(item) -> dict | None:
    if not isinstance(item, dict):
        return None
    name = " ".join(str(item.get("productName") or "").split())
    product_id = _product_id(item.get("productId"))
    if len(name) < 3 or product_id is None:
        return None
    set_name = " ".join(str(item.get("setName") or "").split()) or None
    prices: list[dict] = []
    market = _amount(item.get("marketPrice"))
    low = _amount(item.get("lowestPrice"))
    if market is not None:
        prices.append({"label": "Market", "amount": market})
    if low is not None:
        prices.append({"label": "Low", "amount": low})
    primary = _primary_price(prices)
    return {
        "name": name[:200],
        "url": _catalog_url(product_id, item),
        "set_name": set_name,
        "image_url": None,
        "prices": prices,
        "price": None if primary is None else primary["amount"],
        "price_label": None if primary is None else primary["label"],
        "currency": "USD",
    }


def _catalog_url(product_id: str, item: dict) -> str:
    parts = [
        _slug(item.get("productLineUrlName")),
        _slug(item.get("setUrlName")),
        _slug(item.get("productUrlName")),
    ]
    slug = "-".join(part for part in parts if part)
    if slug:
        return f"{_BASE}/product/{product_id}/{slug}"
    return f"{_BASE}/product/{product_id}"


def _product_id(value) -> str | None:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)):
        number = int(value)
        return str(number) if number > 0 else None
    text = str(value).strip()
    return text if text.isdigit() else None


def _amount(value) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return round(float(value), 2)


def _slug(value) -> str:
    return re.sub(r"[^a-z0-9]+", "-", str(value or "").lower()).strip("-")


def _html_is_shell(html: str) -> bool:
    """True for the unloaded app shell, false for fixture HTML and a real results page."""
    low = (html or "").lower()
    if "tcg-result" in low or _RESULTS_HEADING.search(html or ""):
        return False
    return "<script" in low


def _from_article(article) -> dict | None:
    link = article.select_one("a.tcg-title") or article.select_one("a[href]")
    if link is None:
        return None
    name = " ".join(link.get_text(" ", strip=True).split())
    url = _abs(link.get("href") or "")
    if not name or not url:
        return None
    set_node = article.select_one(".tcg-set")
    set_name = " ".join(set_node.get_text(" ", strip=True).split()) if set_node else None
    prices = _prices(article)
    primary = _primary_price(prices)
    image = article.select_one("img.tcg-image") or article.select_one("img")
    return {
        "name": name,
        "url": url,
        "set_name": set_name or None,
        "image_url": (image.get("src") or "").strip() or None if image is not None else None,
        "prices": prices,
        "price": None if primary is None else primary["amount"],
        "price_label": None if primary is None else primary["label"],
        "currency": "USD",
    }


def _from_link(link) -> dict | None:
    name = " ".join(link.get_text(" ", strip=True).split())
    url = _abs(link.get("href") or "")
    if len(name) < 3 or "/product/" not in url:
        return None
    container = link
    for _ in range(4):
        parent = container.parent
        if parent is None:
            break
        container = parent
        if container.name in {"article", "li", "div", "section"}:
            break
    set_node = container.select_one("[class*='set']")
    set_name = None
    if set_node is not None and set_node is not link:
        set_name = " ".join(set_node.get_text(" ", strip=True).split()) or None
    prices = _prices(container)
    primary = _primary_price(prices)
    image = container.select_one("img")
    return {
        "name": name[:200],
        "url": url,
        "set_name": set_name,
        "image_url": (image.get("src") or "").strip() or None if image is not None else None,
        "prices": prices,
        "price": None if primary is None else primary["amount"],
        "price_label": None if primary is None else primary["label"],
        "currency": "USD",
    }


def _abs(href: str) -> str:
    href = (href or "").strip()
    if not href or href.startswith("#"):
        return ""
    return urljoin(_BASE, href)


_LABELED = re.compile(
    r"\b(market|mid|low|high)\b[^$]{0,24}\$\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?|[0-9]+(?:\.[0-9]{2})?)",
    re.IGNORECASE,
)
_PRICE_ORDER = ("market", "mid", "low", "high", "price")


def _prices(node) -> list[dict]:
    found: list[dict] = []
    seen: set[tuple[str, float]] = set()
    for span in node.select(".tcg-price, [data-price-label]"):
        label = (span.get("data-price-label") or "").strip()
        text = span.get_text(" ", strip=True)
        if not label:
            labeled = _LABELED.search(text)
            label = labeled.group(1).title() if labeled else "Price"
        amount = _price(text)
        if amount is None:
            continue
        key = (label.lower(), amount)
        if key in seen:
            continue
        seen.add(key)
        found.append({"label": label[:40], "amount": amount})
    if found:
        return found
    text = node.get_text(" ", strip=True)
    for labeled in _LABELED.finditer(text):
        amount = float(labeled.group(2).replace(",", ""))
        key = (labeled.group(1).lower(), amount)
        if key in seen:
            continue
        seen.add(key)
        found.append({"label": labeled.group(1).title(), "amount": amount})
    if found:
        return found
    amount = _price(text)
    if amount is not None:
        found.append({"label": "Price", "amount": amount})
    return found


def _primary_price(prices: list[dict]) -> dict | None:
    for label in _PRICE_ORDER:
        for item in prices:
            if str(item.get("label") or "").lower() == label:
                return item
    return prices[0] if prices else None


def _price(text: str) -> float | None:
    match = _MONEY.search(text or "")
    if not match:
        return None
    try:
        return float(match.group(1).replace(",", ""))
    except ValueError:
        return None
