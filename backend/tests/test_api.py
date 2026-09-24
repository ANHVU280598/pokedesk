import time


def _wait(client, job_id, predicate, timeout=8):
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        last = client.get(f"/api/jobs/{job_id}").json()
        if predicate(last):
            return last
        time.sleep(0.05)
    raise AssertionError(last)


def _fixture(client, fixture_set="pokemon", delay_sec=0, max_pages=5):
    response = client.post(
        "/api/jobs",
        json={
            "mode": "fixture",
            "fixture_set": fixture_set,
            "search_query": "Pokemon cards",
            "search_terms": "pokemon cards|fixture",
            "max_pages": max_pages,
            "delay_sec": delay_sec,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_fixture_job_upserts_across_pages_and_lists_results(client):
    created = _fixture(client)
    job = _wait(client, created["id"], lambda item: item["status"] == "completed")
    assert job["pagination_mode"] == "next_page"
    assert job["pages_visited"] == 2
    assert job["items_scraped"] == 4
    assert job["search_terms"] == "pokemon cards|fixture"

    observations = client.get(f"/api/jobs/{job['id']}/observations").json()
    by_asin = {item["asin"]: item for item in observations["items"]}
    assert set(by_asin) == {"B0PKMN0001", "B0PKMN0002", "B0PKMN0003", "B0PKMN0004"}
    assert by_asin["B0PKMN0003"]["price"] == 17.5
    assert by_asin["B0PKMN0003"]["title"] == "Charizard ex Tin (restock)"
    assert by_asin["B0PKMN0003"]["page_number"] == 2
    assert by_asin["B0PKMN0001"]["seller"] == "The Pokemon Company"
    assert by_asin["B0PKMN0001"]["category_breadcrumbs"] == "Toys & Games > Collectible Card Games"

    filtered = client.get(
        f"/api/jobs/{job['id']}/observations",
        params={"min_rating": 4, "q": "tin"},
    ).json()
    assert [item["asin"] for item in filtered["items"]] == ["B0PKMN0003"]

    product = client.get(f"/api/products/{by_asin['B0PKMN0001']['product_id']}").json()
    assert product["asin"] == "B0PKMN0001"
    assert len(product["observations"]) == 1


def test_show_more_captcha_and_page_cap(client):
    show = _wait(
        client,
        _fixture(client, "showmore")["id"],
        lambda item: item["status"] == "completed",
    )
    assert show["pagination_mode"] == "show_more"
    assert show["items_scraped"] == 4
    assert show["pages_visited"] == 2

    captcha = _wait(
        client,
        _fixture(client, "captcha")["id"],
        lambda item: item["status"] == "blocked",
    )
    assert captcha["items_scraped"] == 0
    assert "robot" in captcha["error_message"].lower()

    capped = _wait(
        client,
        _fixture(client, "pagecap")["id"],
        lambda item: item["status"] == "blocked",
    )
    assert capped["items_scraped"] == 1
    assert "capped pagination" in capped["error_message"]
    kept = client.get(f"/api/jobs/{capped['id']}/observations").json()
    assert kept["total"] == 1


def test_pause_and_stop_keep_partial_results(client):
    paused_job = _fixture(client, delay_sec=3)
    running = _wait(
        client,
        paused_job["id"],
        lambda item: item["status"] == "running" and item["pages_visited"] >= 1,
    )
    paused = client.post(f"/api/jobs/{running['id']}/pause")
    assert paused.status_code == 200
    assert paused.json()["status"] == "paused"
    time.sleep(0.4)
    assert client.get(f"/api/jobs/{running['id']}").json()["status"] == "paused"
    assert client.get(f"/api/jobs/{running['id']}").json()["pages_visited"] == 1
    resumed = client.post(f"/api/jobs/{running['id']}/resume")
    assert resumed.status_code == 200
    finished = _wait(client, running["id"], lambda item: item["status"] == "completed")
    assert finished["pages_visited"] == 2
    assert finished["items_scraped"] == 4

    stopped_job = _fixture(client, delay_sec=3)
    _wait(
        client,
        stopped_job["id"],
        lambda item: item["status"] == "running" and item["pages_visited"] >= 1,
    )
    stopped = client.post(f"/api/jobs/{stopped_job['id']}/stop")
    assert stopped.status_code == 200
    body = stopped.json()
    assert body["status"] == "completed"
    assert body["error_message"] == "Stopped by operator"
    time.sleep(0.6)
    settled = client.get(f"/api/jobs/{stopped_job['id']}").json()
    assert settled["status"] == "completed"
    assert settled["pages_visited"] == 1
    assert settled["items_scraped"] == 3


def test_retry_blocked_job_and_reject_bad_urls(client):
    blocked = _wait(
        client,
        _fixture(client, "captcha")["id"],
        lambda item: item["status"] == "blocked",
    )
    retried = client.post(f"/api/jobs/{blocked['id']}/retry")
    assert retried.status_code == 200
    again = _wait(
        client,
        blocked["id"],
        lambda item: item["status"] == "blocked" and item["finished_at"],
    )
    assert "robot" in again["error_message"].lower()

    kept = client.post(f"/api/jobs/{blocked['id']}/stop")
    assert kept.json()["status"] == "blocked"
    assert kept.json()["settings"]["block_acknowledged"] is True

    bad = client.post(
        "/api/jobs",
        json={"mode": "url", "start_url": "https://example.com/s?k=pokemon"},
    )
    assert bad.status_code == 400
    product = client.post(
        "/api/jobs",
        json={"mode": "url", "start_url": "https://www.amazon.com/dp/B0PKMN0001"},
    )
    assert product.status_code == 400
    missing = client.post("/api/jobs", json={"mode": "search", "search_query": "  "})
    assert missing.status_code == 400


def test_settings_roundtrip(client):
    saved = client.put(
        "/api/settings",
        json={"delay_sec": 4, "max_pages": 2, "headless": False},
    )
    assert saved.status_code == 200
    assert client.get("/api/settings").json() == {
        "delay_sec": 4,
        "max_pages": 2,
        "headless": False,
    }
    too_fast = client.post(
        "/api/jobs",
        json={"mode": "search", "search_query": "pokemon cards", "delay_sec": 0.2},
    )
    assert too_fast.status_code == 400
