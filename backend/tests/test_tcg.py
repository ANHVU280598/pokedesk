import asyncio
import threading
import time

from app.tcg.search import choose_match, page_is_blocked, parse_results, search_query
from app.tcg.session import TcgFixtureSession, fixture_html


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
    assert chosen["price_label"] == "Market"
    assert chosen["tcg_set"] == "Scarlet & Violet"
    assert len(chosen["candidates"]) == 1

    several = choose_match("Elite Trainer Box Twilight Masquerade", parse_results(fixture_html("Twilight Masquerade Elite Trainer Box")))
    assert several["status"] == "needs_confirm"
    assert several["tcg_url"] is None
    assert len(several["candidates"]) == 2


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

    jobs_before_click = client.get("/api/jobs").json()
    assert all(item["settings"].get("mode") != "tcgplayer" for item in jobs_before_click)

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
    assert finished["error_message"] == "Matched 2, needs your pick 1, no match 1, errors 0."

    again = client.get(f"/api/jobs/{amazon['id']}/observations").json()["items"]
    by_asin = {item["asin"]: item for item in again}
    booster = by_asin["B0PKMN0001"]
    assert booster["bought_past_month"] == 1000
    assert booster["bought_past_month_text"] == "1K+"
    assert booster["tcg_status"] == "matched"
    assert booster["tcg_match_source"] == "auto"
    assert booster["tcg_name"] == "Scarlet & Violet Booster Box"
    assert booster["tcg_price"] == 139.99
    assert booster["tcg_price_label"] == "Market"
    assert "tcgplayer.com/product/1001/" in booster["tcg_url"]
    etb = by_asin["B0PKMN0002"]
    assert etb["tcg_status"] == "needs_confirm"
    assert etb["tcg_url"] is None
    assert by_asin["B0PKMN0003"]["tcg_name"] == "Charizard ex Tin"
    sleeves = by_asin["B0PKMN0004"]
    assert sleeves["tcg_status"] == "unmatched"
    assert sleeves["tcg_url"] is None
    assert by_asin["B0PKMN0003"]["tcg_match_source"] == "auto"

    skipped = client.post(f"/api/jobs/{amazon['id']}/tcg-match")
    assert skipped.status_code == 201, skipped.text
    skipped_ids = skipped.json()["settings"]["product_ids"]
    assert sorted(skipped_ids) == sorted([etb["product_id"], sleeves["product_id"]])
    skipped_done = _wait(client, skipped.json()["id"], lambda item: item["status"] == "completed")
    assert "Skipped 2 already matched." in skipped_done["error_message"]
    assert "needs your pick 1" in skipped_done["error_message"]
    still = client.get(f"/api/products/{booster['product_id']}").json()
    assert still["tcg_status"] == "matched"
    assert still["tcg_price"] == 139.99
    assert still["tcg_match_source"] == "auto"

    narrow = client.post(f"/api/jobs/{amazon['id']}/tcg-match", json={"q": "Booster"})
    assert narrow.status_code == 400
    assert "Re-match all" in narrow.json()["detail"]

    one = client.post(
        f"/api/jobs/{amazon['id']}/tcg-match",
        json={"product_ids": [booster["product_id"]]},
    )
    assert one.status_code == 201, one.text
    assert one.json()["settings"]["product_ids"] == [booster["product_id"]]
    _wait(client, one.json()["id"], lambda item: item["status"] == "completed")

    catalog_match = client.post("/api/products/tcg-match", json={"q": "Sleeves"})
    assert catalog_match.status_code == 201, catalog_match.text
    assert catalog_match.json()["settings"]["product_ids"] == [sleeves["product_id"]]
    _wait(client, catalog_match.json()["id"], lambda item: item["status"] == "completed")

    product = client.get(f"/api/products/{booster['product_id']}").json()
    assert product["tcg_status"] == "matched"
    compare = client.get(f"/api/products/{booster['product_id']}/compare").json()
    assert compare["amazon"]["price"] == 143.99
    assert compare["tcg"]["price"] == 139.99
    assert compare["tcg"]["price_label"] == "Market"
    assert compare["lower"] == "tcgplayer"
    blocked = client.get(f"/api/products/{etb['product_id']}/compare")
    assert blocked.status_code == 409

    detail = client.get(f"/api/products/{etb['product_id']}").json()
    assert len(detail["tcg_candidates"]) == 2
    choice = next(item for item in detail["tcg_candidates"] if item["name"] == "Twilight Masquerade Elite Trainer Box")
    confirmed = client.post(
        f"/api/products/{etb['product_id']}/tcg-confirm",
        json={"candidate_id": choice["id"]},
    )
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json()["tcg_status"] == "matched"
    assert confirmed.json()["tcg_match_source"] == "confirmed"
    assert confirmed.json()["tcg_price"] == 44.95
    etb_compare = client.get(f"/api/products/{etb['product_id']}/compare").json()
    assert etb_compare["amazon"]["price"] == 49.5
    assert etb_compare["lower"] == "tcgplayer"
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


def _fixture_amazon(client):
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
    return _wait(client, created.json()["id"], lambda item: item["status"] == "completed")


def test_one_row_error_does_not_stop_the_rest_of_the_list(client, monkeypatch):
    amazon = _fixture_amazon(client)
    original = TcgFixtureSession.search

    async def flaky(self, query: str) -> str:
        if query == "Sleeves":
            raise RuntimeError("tcgplayer fixture exploded")
        return await original(self, query)

    monkeypatch.setattr(TcgFixtureSession, "search", flaky)
    match = client.post(f"/api/jobs/{amazon['id']}/tcg-match")
    assert match.status_code == 201, match.text
    finished = _wait(client, match.json()["id"], lambda item: item["status"] == "completed")
    assert finished["status"] == "completed"
    assert "errors 1" in finished["error_message"]
    rows = client.get(f"/api/jobs/{amazon['id']}/observations").json()["items"]
    by_asin = {item["asin"]: item for item in rows}
    assert by_asin["B0PKMN0001"]["tcg_status"] == "matched"
    assert by_asin["B0PKMN0002"]["tcg_status"] == "needs_confirm"
    assert by_asin["B0PKMN0004"]["tcg_status"] == "error"
    assert "exploded" in (by_asin["B0PKMN0004"]["tcg_error"] or "")


def test_soft_block_stops_the_batch_and_keeps_the_message(client, monkeypatch):
    amazon = _fixture_amazon(client)
    original = TcgFixtureSession.search
    queries: list[str] = []

    async def blocked_first(self, query: str) -> str:
        queries.append(query)
        if len(queries) == 1:
            self.last_status = 200
            return "<html>verify you are human</html>"
        return await original(self, query)

    monkeypatch.setattr(TcgFixtureSession, "search", blocked_first)
    match = client.post(f"/api/jobs/{amazon['id']}/tcg-match")
    assert match.status_code == 201, match.text
    finished = _wait(client, match.json()["id"], lambda item: item["status"] == "completed")
    assert finished["status"] == "completed"
    assert "Stopped after a TCGPlayer block" in finished["error_message"]
    assert queries == ["Scarlet Violet Booster Box"]
    rows = client.get(f"/api/jobs/{amazon['id']}/observations").json()["items"]
    by_asin = {item["asin"]: item for item in rows}
    assert by_asin["B0PKMN0001"]["tcg_status"] == "error"
    assert "soft-blocked" in (by_asin["B0PKMN0001"]["tcg_error"] or "")
    assert by_asin["B0PKMN0002"]["tcg_status"] is None
    assert by_asin["B0PKMN0004"]["tcg_status"] is None


def test_cancel_keeps_the_cancel_message(client, monkeypatch):
    amazon = _fixture_amazon(client)
    started = threading.Event()
    release = threading.Event()
    original = TcgFixtureSession.search

    async def hold(self, query: str) -> str:
        started.set()
        while not release.is_set():
            await asyncio.sleep(0.02)
        return await original(self, query)

    monkeypatch.setattr(TcgFixtureSession, "search", hold)
    match = client.post(f"/api/jobs/{amazon['id']}/tcg-match")
    assert match.status_code == 201, match.text
    job_id = match.json()["id"]
    try:
        assert started.wait(3)
        progress = client.get(f"/api/jobs/{job_id}").json()
        assert progress["status"] == "running"
        assert progress["error_message"].startswith("Matching 1 /")
        stopped = client.post(f"/api/jobs/{job_id}/stop")
        assert stopped.status_code == 200, stopped.text
        assert stopped.json()["error_message"] == "Match cancelled. Rows already checked were kept."
    finally:
        release.set()
    finished = _wait(client, job_id, lambda item: item["status"] == "completed")
    assert finished["error_message"] == "Match cancelled. Rows already checked were kept."
