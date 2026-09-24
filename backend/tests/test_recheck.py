import time


def _wait(client, job_id, predicate, timeout=12):
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        last = client.get(f"/api/jobs/{job_id}").json()
        if predicate(last):
            return last
        time.sleep(0.05)
    raise AssertionError(last)


def _fixture(client, fixture_set):
    response = client.post(
        "/api/jobs",
        json={
            "mode": "fixture",
            "fixture_set": fixture_set,
            "search_query": "Pokemon cards",
            "search_terms": "pokemon cards|fixture",
            "max_pages": 5,
            "delay_sec": 0,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_recheck_continue_scrapes_the_next_page(client):
    capped = _wait(
        client,
        _fixture(client, "pagecap")["id"],
        lambda item: item["status"] == "blocked",
    )
    assert capped["items_scraped"] == 1
    assert capped["pages_visited"] == 1

    queued = client.post(f"/api/jobs/{capped['id']}/recheck", json={"mode": "continue"})
    assert queued.status_code == 200, queued.text
    assert queued.json()["status"] == "queued"
    assert queued.json()["settings"]["resume_url"] == "fixture://pagecap/2"

    done = _wait(client, capped["id"], lambda item: item["status"] == "completed")
    assert done["pages_visited"] == 2
    assert done["items_scraped"] == 2
    assert "more pages were available" in done["error_message"].lower()
    assert done["settings"]["recheck_outcome"] == "advanced"
    observations = client.get(f"/api/jobs/{capped['id']}/observations").json()
    assert {item["asin"] for item in observations["items"]} == {"B0CAP00001", "B0CAP00002"}


def test_recheck_reload_stays_capped_and_keeps_rows(client):
    capped = _wait(
        client,
        _fixture(client, "pagecap")["id"],
        lambda item: item["status"] == "blocked",
    )
    queued = client.post(f"/api/jobs/{capped['id']}/recheck", json={"mode": "reload"})
    assert queued.status_code == 200, queued.text
    assert queued.json()["settings"]["resume_url"] == "fixture://pagecap/1"

    again = _wait(
        client,
        capped["id"],
        lambda item: item["status"] == "blocked" and item["settings"].get("recheck_outcome") == "unchanged",
    )
    assert "still capped" in again["error_message"].lower()
    assert "another round" in again["error_message"].lower()
    assert again["items_scraped"] == 1
    assert again["pages_visited"] == 1
    kept = client.get(f"/api/jobs/{capped['id']}/observations").json()
    assert kept["total"] == 1
    assert kept["items"][0]["asin"] == "B0CAP00001"

    refused = client.post(f"/api/jobs/{capped['id']}/recheck", json={"mode": "continue"})
    # still blocked, so a second recheck is allowed; use a completed job for 409
    finished = _wait(
        client,
        _fixture(client, "pokemon")["id"],
        lambda item: item["status"] == "completed",
    )
    assert client.post(f"/api/jobs/{finished['id']}/recheck", json={"mode": "reload"}).status_code == 409
    assert refused.status_code == 200


def test_followups_recheck_the_parent_after_they_finish(client):
    blocked = _wait(
        client,
        _fixture(client, "captcha")["id"],
        lambda item: item["status"] == "blocked",
    )
    created = client.post(
        f"/api/jobs/{blocked['id']}/follow-ups",
        json={"suggestion_ids": ["price:under-25"]},
    )
    assert created.status_code == 201, created.text
    assert created.json()["parent"]["settings"]["recheck_pending"] is True
    assert created.json()["parent"]["status"] == "blocked"

    again = _wait(
        client,
        blocked["id"],
        lambda item: item["status"] == "blocked" and item["settings"].get("recheck_outcome") == "unchanged",
    )
    assert "no extra page" in again["error_message"].lower()
    assert "robot" in again["error_message"].lower()
    assert "slice" in again["error_message"].lower()
    assert again["items_scraped"] == 0
