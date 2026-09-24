from urllib.parse import unquote

from app.schemas import JobCreate
from app.scraper.fixtures import load_bundle
from app.scraper.parser import parse_results
from app.scraper.urls import build_search_url, validate_amazon_url
from app.service import compose_new_job


def test_pokemon_fixture_page_extracts_cards_and_next_link():
    html = load_bundle("pokemon")[1]
    parsed = parse_results(html, "fixture://pokemon/1")
    assert parsed.block_reason is None
    assert [card.asin for card in parsed.cards] == ["B0PKMN0001", "B0PKMN0002", "B0PKMN0003"]
    first = parsed.cards[0]
    assert first.title == "Pokemon TCG: Scarlet & Violet Booster Box"
    assert first.price == 143.99
    assert first.currency == "USD"
    assert first.list_price == 169.99
    assert first.rating == 4.8
    assert first.review_count == 12403
    assert first.badges == ["Best Seller"]
    assert first.seller == "The Pokemon Company"
    assert first.availability_snippet.startswith("Only 4 left")
    assert first.product_url == "https://www.amazon.com/dp/B0PKMN0001"
    assert parsed.cards[1].badges == ["Amazon's Choice", "Sponsored"]
    assert parsed.cards[2].review_count == 2300
    assert parsed.pagination_mode == "next_page"
    assert parsed.next_url == "fixture://pokemon/2"
    assert parsed.breadcrumbs == "Toys & Games > Collectible Card Games"
    assert parsed.suggests_more is True


def test_last_fixture_page_has_no_next_link():
    html = load_bundle("pokemon")[2]
    parsed = parse_results(html, "fixture://pokemon/2")
    assert parsed.pagination_mode == "none"
    assert parsed.suggests_more is False
    assert parsed.cards[0].price == 17.50
    assert parsed.cards[0].title == "Charizard ex Tin (restock)"


def test_show_more_and_page_cap_and_captcha():
    show = parse_results(load_bundle("showmore")[1], "fixture://showmore/1")
    assert show.pagination_mode == "show_more"
    assert show.next_url is None
    assert show.suggests_more is True

    cap = parse_results(load_bundle("pagecap")[1], "https://www.amazon.com/s?k=pokemon")
    assert cap.pagination_mode == "none"
    assert cap.suggests_more is True
    assert len(cap.cards) == 1

    blocked = parse_results(load_bundle("captcha")[1], "https://www.amazon.com/errors/validateCaptcha")
    assert blocked.cards == []
    assert "robot" in blocked.block_reason.lower()


def test_relative_next_link_missing_price_and_duplicate_asin():
    html = """
    <div data-component-type="s-search-result" data-asin="B0REL00001">
      <h2><a href="/dp/B0REL00001"><span>Loose code card</span></a></h2>
    </div>
    <div data-component-type="s-search-result" data-asin="B0REL00001">
      <h2><a href="/dp/B0REL00001"><span>Loose code card duplicate</span></a></h2>
      <span class="a-price"><span class="a-offscreen">€12,50</span></span>
    </div>
    <div data-component-type="s-search-result" data-asin="B0REL00002">
      <h2><a href="/s?k=next"><span>Priced in euros</span></a></h2>
      <span class="a-price"><span class="a-offscreen">€12.50</span></span>
      <span aria-label="1.2K ratings">1.2K</span>
    </div>
    <a class="s-pagination-next" href="/s?k=pokemon&amp;page=2" aria-label="Go to next page, page 2">Next</a>
    <span class="s-pagination-next s-pagination-disabled">Next</span>
    """
    parsed = parse_results(html, "https://www.amazon.com/s?k=pokemon")
    assert [card.asin for card in parsed.cards] == ["B0REL00001", "B0REL00002"]
    assert parsed.cards[0].price is None
    assert parsed.cards[1].price == 12.50
    assert parsed.cards[1].currency == "EUR"
    assert parsed.cards[1].review_count == 1200
    assert parsed.next_url == "https://www.amazon.com/s?k=pokemon&page=2"


def test_search_url_and_validation():
    url = build_search_url("pokemon cards", 10, 40, "toys-and-games")
    decoded = unquote(url)
    assert decoded.startswith("https://www.amazon.com/s?")
    assert "k=pokemon+cards" in url
    assert "i=toys-and-games" in decoded
    assert "rh=p_36:1000-4000" in decoded

    spec = compose_new_job(
        JobCreate(
            mode="search",
            search_query="pokemon booster box",
            search_terms="pokemon cards|booster box",
            min_price=10,
            max_price=80,
            department="toys-and-games",
        ),
        {"delay_sec": 4, "max_pages": 2, "headless": False},
    )
    assert spec["search_terms"] == "pokemon cards|booster box"
    assert "k=pokemon+booster+box" in spec["start_url"]
    assert "i=toys-and-games" in spec["start_url"]
    assert spec["settings"]["max_pages"] == 2
    assert spec["settings"]["delay_ms"] == 4000
    assert spec["settings"]["headless"] is False

    assert validate_amazon_url("https://www.amazon.com/s?k=pokemon+cards").startswith("https://")
    for bad in (
        "https://example.com/s?k=pokemon",
        "https://www.amazon.com/dp/B0PKMN0001",
        "not a url",
    ):
        try:
            validate_amazon_url(bad)
        except ValueError:
            continue
        raise AssertionError(f"expected rejection for {bad}")
