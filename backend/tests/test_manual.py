import time

from app.links import LinkError, amazon_product_url, tcg_product_url
from app.scraper.product_page import amazon_product_fixture, parse_amazon_product_page
from app.tcg.product_page import parse_tcg_product_page, tcg_product_fixture


def _wait(client, job_id, predicate, timeout=8):
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        last = client.get(f"/api/jobs/{job_id}").json()
        if predicate(last):
            return last
        time.sleep(0.05)
    raise AssertionError(last)


def test_product_urls_reject_search_pages_and_other_hosts():
    url, product_id = tcg_product_url(
        "https://www.tcgplayer.com/product/1001/scarlet-violet-booster-box?page=1"
    )
    assert url == "https://www.tcgplayer.com/product/1001/scarlet-violet-booster-box"
    assert product_id == "1001"
    amazon, asin = amazon_product_url("https://www.amazon.com/Pokemon-Booster/dp/b0pkmn0001/ref=sr")
    assert amazon == "https://www.amazon.com/dp/B0PKMN0001"
    assert asin == "B0PKMN0001"
    for bad in (
        "https://www.tcgplayer.com/search/pokemon/product?q=charizard",
        "https://example.com/product/1001/card",
        "not a url",
        "",
    ):
        try:
            tcg_product_url(bad)
        except LinkError as exc:
            assert "TCGPlayer product URL" in str(exc)
        else:
            raise AssertionError(bad)
    try:
        amazon_product_url("https://www.amazon.co.uk/dp/B0PKMN0001")
    except LinkError as exc:
        assert "amazon.com" in str(exc)
    else:
        raise AssertionError("uk host")


def test_live_price_guide_ignores_prices_outside_the_product():
    html = """
    <html><body>
      <nav><span class="tcg-price" data-price-label="Market">$1.00</span></nav>
      <section class="product-details">
        <h1 class="product-details__name">Charizard ex - 151</h1>
        <div class="product-details__name__sub-header">Scarlet &amp; Violet 151</div>
        <img src="https://tcgplayer-cdn.tcgplayer.com/product/502061_in_200x200.jpg" alt="" />
        <section class="product-details__price-guide">
          <table><tr><td>Market Price</td><td>$33.87</td></tr>
          <tr><td>Most Recent Sale</td><td>N/A</td></tr>
          <tr><td>Low Volatility</td><td>$9.00</td></tr></table>
        </section>
      </section>
    </body></html>
    """
    parsed = parse_tcg_product_page(
        html,
        "https://www.tcgplayer.com/product/502061/pokemon-sv-scarlet-violet-151-charizard-ex",
    )
    assert parsed["name"].startswith("Charizard ex")
    assert parsed["set_name"] == "Scarlet & Violet 151"
    assert parsed["price"] == 33.87
    assert parsed["price_label"] == "Market"
    assert [item["label"] for item in parsed["prices"]] == ["Market"]
    assert "502061" in parsed["image_url"]


def test_product_page_fixtures_keep_only_printed_fields():
    tcg = parse_tcg_product_page(
        tcg_product_fixture(),
        "https://www.tcgplayer.com/product/1001/scarlet-violet-booster-box",
    )
    assert tcg["name"] == "Scarlet & Violet Booster Box"
    assert tcg["set_name"] == "Scarlet & Violet"
    assert tcg["price"] == 139.99
    assert tcg["price_label"] == "Market"
    assert {item["label"] for item in tcg["prices"]} == {"Market", "Low"}
    assert tcg["image_url"].endswith("/1001.jpg")

    bare = tcg_product_fixture(market="", low="")
    try:
        parse_tcg_product_page(bare.replace("$", ""), "https://www.tcgplayer.com/product/1001/card")
    except Exception as exc:
        assert "Market" in str(exc)
    else:
        raise AssertionError("empty prices")

    amazon = parse_amazon_product_page(
        amazon_product_fixture(),
        "https://www.amazon.com/dp/B0PKMN0001",
        asin="B0PKMN0001",
    )
    assert amazon["title"] == "Pokemon TCG: Scarlet & Violet Booster Box"
    assert amazon["asin"] == "B0PKMN0001"
    assert amazon["price"] == 143.99
    assert amazon["list_price"] == 159.99
    assert amazon["currency"] == "USD"
    try:
        parse_amazon_product_page(
            amazon_product_fixture(asin="B0OTHER001"),
            "https://www.amazon.com/dp/B0PKMN0001",
            asin="B0PKMN0001",
        )
    except Exception as exc:
        assert "B0OTHER001" in str(exc)
    else:
        raise AssertionError("asin mismatch")


def test_manual_url_links_a_row_and_batch_matching_leaves_it_alone(client, monkeypatch):
    created = client.post(
        "/api/jobs",
        json={
            "mode": "fixture",
            "fixture_set": "pokemon",
            "max_pages": 40,
            "delay_sec": 0,
            "expand_related": False,
            "recheck_after_block": False,
        },
    )
    assert created.status_code == 201, created.text
    amazon = _wait(client, created.json()["id"], lambda item: item["status"] == "completed")
    rows = client.get(f"/api/jobs/{amazon['id']}/observations").json()["items"]
    sleeves = next(item for item in rows if item["asin"] == "B0PKMN0004")
    before = len(client.get(f"/api/products/{sleeves['product_id']}").json()["observations"])

    async def fake_fetch(pages):
        assert pages[0][0].startswith("https://www.tcgplayer.com/product/1001/")
        return [(tcg_product_fixture(), 200)]

    monkeypatch.setattr("app.manual_match.fetch_documents", fake_fetch)
    linked = client.post(
        f"/api/products/{sleeves['product_id']}/tcg-url",
        json={"url": "https://www.tcgplayer.com/product/1001/scarlet-violet-booster-box"},
    )
    assert linked.status_code == 200, linked.text
    body = linked.json()
    assert body["tcg_status"] == "matched"
    assert body["tcg_match_source"] == "manual"
    assert body["tcg_name"] == "Scarlet & Violet Booster Box"
    assert body["tcg_price"] == 139.99
    assert body["tcg_price_label"] == "Market"
    assert body["tcg_price_history"][0]["price"] == 139.99
    assert body["tcg_price_history"][0]["tcg_product_id"] == "1001"
    assert len(body["observations"]) == before

    invalid = client.post(
        f"/api/products/{sleeves['product_id']}/tcg-url",
        json={"url": "https://www.tcgplayer.com/search/pokemon/product?q=sleeves"},
    )
    assert invalid.status_code == 400
    assert "TCGPlayer product URL" in invalid.json()["detail"]
    still = client.get(f"/api/products/{sleeves['product_id']}").json()
    assert still["tcg_url"].endswith("/scarlet-violet-booster-box")

    blocked_html = "<html>verify you are human</html>"

    async def blocked(_pages):
        return [(blocked_html, 200)]

    monkeypatch.setattr("app.manual_match.fetch_documents", blocked)
    refused = client.post(
        f"/api/products/{sleeves['product_id']}/tcg-url",
        json={"url": "https://www.tcgplayer.com/product/77/other-card"},
    )
    assert refused.status_code == 400
    assert "blocked" in refused.json()["detail"].lower()
    unchanged = client.get(f"/api/products/{sleeves['product_id']}").json()
    assert unchanged["tcg_price"] == 139.99
    assert len(unchanged["tcg_price_history"]) == 1

    rematch = client.post(f"/api/jobs/{amazon['id']}/tcg-match", json={"rematch": True})
    assert rematch.status_code == 201, rematch.text
    assert sleeves["product_id"] not in rematch.json()["settings"]["product_ids"]
    assert rematch.json()["settings"]["skipped_manual"] == 1
    finished = _wait(client, rematch.json()["id"], lambda item: item["status"] == "completed")
    assert "Skipped 1 manual." in finished["error_message"]
    kept = client.get(f"/api/products/{sleeves['product_id']}").json()
    assert kept["tcg_match_source"] == "manual"
    assert kept["tcg_price"] == 139.99

    one = client.post(
        f"/api/jobs/{amazon['id']}/tcg-match",
        json={"product_ids": [sleeves["product_id"]], "rematch": True},
    )
    assert one.status_code == 400
    assert "manual" in one.json()["detail"].lower()

    compare = client.get(f"/api/products/{sleeves['product_id']}/compare").json()
    assert compare["match_source"] == "manual"
    assert compare["tcg"]["price"] == 139.99
    export = client.get(
        "/api/exports/price-compare",
        params={"job_id": amazon["id"], "format": "csv"},
    )
    assert export.status_code == 200
    assert "B0PKMN0004" in export.text
    assert "manual" in export.text


def test_manual_pair_creates_or_refreshes_amazon_and_opens_a_confirmed_match(client, monkeypatch):
    calls = {"n": 0}

    async def fake_fetch(pages):
        calls["n"] += 1
        if calls["n"] == 1:
            return [
                (amazon_product_fixture(asin="B0MANUAL01", price="150.00"), 200),
                (tcg_product_fixture(market="140.00"), 200),
            ]
        return [
            (amazon_product_fixture(asin="B0MANUAL01", price="148.50"), 200),
            (tcg_product_fixture(market="141.25", low="130.00"), 200),
        ]

    monkeypatch.setattr("app.manual_match.fetch_documents", fake_fetch)
    first = client.post(
        "/api/manual-match",
        json={
            "amazon_url": "https://www.amazon.com/dp/B0MANUAL01",
            "tcg_url": "https://www.tcgplayer.com/product/1001/scarlet-violet-booster-box",
        },
    )
    assert first.status_code == 201, first.text
    product = first.json()
    assert product["asin"] == "B0MANUAL01"
    assert product["tcg_match_source"] == "manual"
    assert product["observations"][0]["price"] == 150.0
    assert len(product["tcg_price_history"]) == 1

    second = client.post(
        "/api/manual-match",
        json={
            "amazon_url": "https://www.amazon.com/gp/product/B0MANUAL01",
            "tcg_url": "https://www.tcgplayer.com/product/1001/scarlet-violet-booster-box",
        },
    )
    assert second.status_code == 201, second.text
    refreshed = second.json()
    assert refreshed["id"] == product["id"]
    assert len(refreshed["observations"]) == 2
    assert refreshed["observations"][0]["price"] == 148.5
    assert {item["price"] for item in refreshed["observations"]} == {150.0, 148.5}
    assert refreshed["tcg_price"] == 141.25
    assert len(refreshed["tcg_price_history"]) == 2

    cleared = client.delete(f"/api/products/{product['id']}/tcg-match")
    assert cleared.status_code == 200
    assert cleared.json()["tcg_status"] is None
    assert cleared.json()["tcg_match_source"] is None
