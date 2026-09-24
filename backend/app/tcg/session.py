"""Saved TCGPlayer search HTML so fixture jobs never open the live site."""

from __future__ import annotations

from app.tcg.search import search_query


def _card(name: str, slug: str, set_name: str, price: str) -> str:
    url = f"https://www.tcgplayer.com/product/{slug}"
    return (
        '<article class="tcg-result">'
        f'<a class="tcg-title" href="{url}">{name}</a>'
        f'<span class="tcg-set">{set_name}</span>'
        f'<span class="tcg-price">${price}</span>'
        "</article>"
    )


def fixture_html(query: str) -> str:
    text = (query or "").lower()
    cards = ""
    if "scarlet" in text and "violet" in text and "booster" in text:
        cards = _card(
            "Scarlet &amp; Violet Booster Box",
            "1001/scarlet-violet-booster-box",
            "Scarlet &amp; Violet",
            "139.99",
        )
    elif "twilight" in text and "masquerade" in text:
        cards = _card(
            "Twilight Masquerade Elite Trainer Box",
            "1002/twilight-masquerade-elite-trainer-box",
            "Twilight Masquerade",
            "44.95",
        )
    elif "charizard" in text:
        cards = _card(
            "Charizard Plush",
            "9001/charizard-plush",
            "Merchandise",
            "24.00",
        ) + _card(
            "Charizard ex Tin",
            "1003/charizard-ex-tin",
            "Scarlet &amp; Violet",
            "18.50",
        )
    return f"<html><body><main>{cards}</main></body></html>"


class TcgFixtureSession:
    """One in-memory session for a whole match pass. No browser."""

    def __init__(self) -> None:
        self.last_status: int | None = 200
        self.queries: list[str] = []
        self.url = "fixture://tcgplayer"

    async def search(self, query: str) -> str:
        self.queries.append(query)
        self.url = f"fixture://tcgplayer?q={search_query(query)}"
        self.last_status = 200
        return fixture_html(query)

    def current_url(self) -> str:
        return self.url

    async def close(self) -> None:
        return None
