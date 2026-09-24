"""Build a TCGPlayer query from an Amazon title and pick a best-effort hit.

An empty search, or a hit that does not share a distinctive name token with
the Amazon title, stays unmatched. Nothing here invents a listing.
"""

from __future__ import annotations

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
TCG_READY = (
    "article.tcg-result, a[href*='/product/'], "
    "#challenge-running, form[action*='challenge'], .cf-error-details"
)


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
    """Return a stored match row: matched, needs_review, or unmatched."""
    query_tokens = tokens(query)
    best: dict | None = None
    best_score = 0.0
    for hit in hits:
        name = f"{hit.get('name') or ''} {hit.get('set_name') or ''}"
        score = _overlap(query_tokens, tokens(name))
        if score > best_score:
            best = hit
            best_score = score
    if best is None or best_score < 0.5 or not query_tokens:
        return _unmatched(query)
    shared = set(query_tokens) & set(tokens(best.get("name") or ""))
    distinctive = shared - _GENERIC
    if not distinctive:
        if best_score >= 0.75 and shared:
            status = "needs_review"
        else:
            return _unmatched(query)
    elif best_score >= 0.75:
        status = "matched"
    else:
        status = "needs_review"
    return {
        "query": query,
        "status": status,
        "tcg_url": best.get("url"),
        "tcg_name": best.get("name"),
        "tcg_set": best.get("set_name"),
        "price": best.get("price"),
        "currency": best.get("currency") or "USD",
        "confidence": round(best_score, 2),
        "raw": {"hit": best, "result_count": len(hits)},
    }


def _overlap(query_tokens: list[str], hit_tokens: list[str]) -> float:
    if not query_tokens or not hit_tokens:
        return 0.0
    shared = set(query_tokens) & set(hit_tokens)
    return len(shared) / len(set(query_tokens))


def _unmatched(query: str) -> dict:
    return {
        "query": query,
        "status": "unmatched",
        "tcg_url": None,
        "tcg_name": None,
        "tcg_set": None,
        "price": None,
        "currency": None,
        "confidence": 0.0,
        "raw": {"hit": None, "result_count": 0},
    }


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
    return {
        "name": name,
        "url": url,
        "set_name": set_name or None,
        "price": _price(article.get_text(" ", strip=True)),
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
    text = container.get_text(" ", strip=True)
    set_node = container.select_one("[class*='set']")
    set_name = None
    if set_node is not None and set_node is not link:
        set_name = " ".join(set_node.get_text(" ", strip=True).split()) or None
    return {
        "name": name[:200],
        "url": url,
        "set_name": set_name,
        "price": _price(text),
        "currency": "USD",
    }


def _abs(href: str) -> str:
    href = (href or "").strip()
    if not href or href.startswith("#"):
        return ""
    return urljoin(_BASE, href)


def _price(text: str) -> float | None:
    match = _MONEY.search(text or "")
    if not match:
        return None
    try:
        return float(match.group(1).replace(",", ""))
    except ValueError:
        return None
