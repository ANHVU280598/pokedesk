import time

from app.tcg.search import choose_match, page_is_blocked, parse_results, search_query
from app.tcg.session import fixture_html


def _wait(client, job_id, predicate, timeout=8):
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        last = client.get(f"/api/jobs/{job_id}").json()
        if predicate(last):
            return last
        time.sleep(0.05)
    raise AssertionError(last)


def test_search_query_drops_pokemon_noise():
    assert search_query("Pokemon TCG: Scarlet & Violet Booster Box") == "Scarlet Violet Booster Box"
    assert search_query("Pokemon Trading Card Game Sleeves") == "Sleeves"
    assert "36" not in search_query("Pokemon 36 Pack Booster Bundle")


def test_choose_match_skips_empty_and_unrelated_hits():
    empty = choose_match("Charizard ex Tin", [])
    assert empty["status"] == "unmatched"
    assert empty["tcg_url"] is None

    unrelated = choose_match(
        "Charizard ex Tin",
        [
            {
                "name": "Kitchen Sponge Set",
                "url": "https://www.tcgplayer.com/product/9/sponge",
                "set_name": None,
                "price": 4.0,
                "currency": "USD",
            }
        ],
    )
    assert unrelated["status"] == "unmatched"

    parsed = parse_results(fixture_html("Charizard ex Tin"))
    chosen = choose_match("Charizard ex Tin", parsed)
    assert chosen["status"] == "matched"
    assert chosen["tcg_name"] == "Charizard ex Tin"
    assert chosen["tcg_url"].endswith("/1003/charizard-ex-tin")
    assert chosen["price"] == 18.5
    assert chosen["tcg_set"] == "Scarlet & Violet"


def test_blocked_page_is_detected_without_treating_a_normal_miss_as_a_block():
    assert page_is_blocked("<html>verify you are human</html>", 200)
    assert page_is_blocked("<html><article class='tcg-result'></article></html>", 200) is False
    assert page_is_blocked("", 429)


def test_fixture_job_match_links_cards_and_leaves_sleeves_unmatched(client):
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
    assert amazon["pages_visited"] == 2
    assert amazon["settings"]["max_pages"] == 40

    observations = client.get(f"/api/jobs/{amazon['id']}/observations").json()["items"]
    by_asin = {item["asin"]: item for item in observations}
    assert by_asin["B0PKMN0001"]["bought_past_month"] == 1000
    assert by_asin["B0PKMN0001"]["tcg_status"] is None

    match = client.post(f"/api/jobs/{amazon['id']}/tcg-match")
    assert match.status_code == 201, match.text
    body = match.json()
    assert body["settings"]["mode"] == "tcgplayer"
    assert body["settings"]["fixture"] is True
    assert body["settings"]["source_job_id"] == amazon["id"]
    finished = _wait(client, body["id"], lambda item: item["status"] == "completed")
    assert finished["pages_visited"] == 4
    assert finished["error_message"] == "Matched 3, needs review 0, unmatched 1."

    again = client.get(f"/api/jobs/{amazon['id']}/observations").json()["items"]
    by_asin = {item["asin"]: item for item in again}
    booster = by_asin["B0PKMN0001"]
    assert booster["bought_past_month"] == 1000
    assert booster["bought_past_month_text"] == "1K+"
    assert booster["tcg_status"] == "matched"
    assert booster["tcg_name"] == "Scarlet & Violet Booster Box"
    assert booster["tcg_price"] == 139.99
    assert "tcgplayer.com/product/1001/" in booster["tcg_url"]
    assert by_asin["B0PKMN0002"]["tcg_status"] == "matched"
    assert by_asin["B0PKMN0003"]["tcg_name"] == "Charizard ex Tin"
    sleeves = by_asin["B0PKMN0004"]
    assert sleeves["tcg_status"] == "unmatched"
    assert sleeves["tcg_url"] is None

    product = client.get(f"/api/products/{booster['product_id']}").json()
    assert product["tcg_status"] == "matched"
    catalog = client.get("/api/products", params={"q": "Sleeves"}).json()
    sleeve_row = next(item for item in catalog["items"] if item["asin"] == "B0PKMN0004")
    assert sleeve_row["tcg_status"] == "unmatched"

    cleared = client.delete(f"/api/products/{sleeves['product_id']}/tcg-match")
    assert cleared.status_code == 200
    assert cleared.json()["tcg_status"] is None

    rerun = client.post(
        "/api/products/tcg-match",
        json={"product_ids": [sleeves["product_id"]]},
    )
    assert rerun.status_code == 201, rerun.text
    assert rerun.json()["settings"]["fixture"] is True
    _wait(client, rerun.json()["id"], lambda item: item["status"] == "completed")
    restored = client.get(f"/api/products/{sleeves['product_id']}").json()
    assert restored["tcg_status"] == "unmatched"

    wiped = client.delete(f"/api/jobs/{amazon['id']}/tcg-match")
    assert wiped.status_code == 200
    assert wiped.json()["cleared"] == 4
    bare = client.get(f"/api/jobs/{amazon['id']}/observations").json()["items"]
    assert all(item["tcg_status"] is None for item in bare)
