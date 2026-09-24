import json
import os
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


def _related(client, *, limit=3, delay_sec=0, expand=True, recheck=True, max_pages=5):
    response = client.post(
        "/api/jobs",
        json={
            "mode": "fixture",
            "fixture_set": "relatedcap",
            "search_query": "Pokemon cards",
            "search_terms": "pokemon cards|fixture",
            "max_pages": max_pages,
            "delay_sec": delay_sec,
            "expand_related": expand,
            "related_cards_limit": limit,
            "recheck_after_block": recheck,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_pattern_settings_are_persisted(client):
    saved = client.put(
        "/api/settings",
        json={
            "delay_sec": 2.5,
            "max_pages": 3,
            "headless": True,
            "expand_related": False,
            "related_cards_limit": 7,
            "recheck_after_block": False,
        },
    )
    assert saved.status_code == 200, saved.text
    body = saved.json()
    assert body["expand_related"] is False
    assert body["related_cards_limit"] == 7
    assert body["recheck_after_block"] is False
    assert client.get("/api/settings").json()["related_cards_limit"] == 7

    stored = json.loads(open(os.environ["SCRAPE_SETTINGS_PATH"], encoding="utf-8").read())
    assert stored["expand_related"] is False
    assert stored["related_cards_limit"] == 7
    assert stored["recheck_after_block"] is False

    created = client.post(
        "/api/jobs",
        json={
            "mode": "fixture",
            "fixture_set": "pokemon",
            "search_query": "Pokemon cards",
            "max_pages": 1,
            "delay_sec": 0,
        },
    )
    assert created.status_code == 201, created.text
    settings = created.json()["settings"]
    assert settings["expand_related"] is False
    assert settings["related_cards_limit"] == 7
    assert settings["recheck_after_block"] is False


def test_blocked_job_expands_related_cards_then_rechecks(client):
    created = _related(client, limit=3)
    done = _wait(
        client,
        created["id"],
        lambda item: item["status"] == "blocked" and item["settings"].get("recheck_outcome"),
    )
    assert done["settings"]["related_visited"] == 3
    assert done["settings"]["pattern_handled"] is True
    assert done["settings"]["recheck_outcome"] == "unchanged"
    assert "still capped" in done["error_message"].lower()
    assert done["pages_visited"] == 1

    observations = client.get(f"/api/jobs/{done['id']}/observations").json()
    by_asin = {item["asin"]: item for item in observations["items"]}
    assert set(by_asin) == {
        "B0SEED0001",
        "B0SEED0002",
        "B0SEED0003",
        "B0REL10001",
        "B0REL10002",
    }
    assert by_asin["B0SEED0001"]["source"] == "results"
    assert by_asin["B0REL10001"]["source"] == "related"
    assert by_asin["B0REL10001"]["title"] == "Related Pikachu Tin"
    assert by_asin["B0REL10001"]["price"] == 12
    assert by_asin["B0REL10002"]["price"] == 9.5
    assert done["items_scraped"] == 5


def test_related_expansion_respects_the_card_limit(client):
    created = _related(client, limit=2, recheck=True)
    done = _wait(
        client,
        created["id"],
        lambda item: item["status"] == "blocked" and item["settings"].get("recheck_outcome"),
    )
    assert done["settings"]["related_visited"] == 2
    assert done["settings"]["related_cards_limit"] == 2
    observations = client.get(f"/api/jobs/{done['id']}/observations").json()
    related = [item for item in observations["items"] if item["source"] == "related"]
    assert {item["asin"] for item in related} == {"B0REL10001", "B0REL10002"}
    assert done["settings"]["recheck_outcome"] == "unchanged"


def test_pause_and_stop_during_related_expansion(client):
    paused_job = _related(client, limit=3, delay_sec=3, recheck=False)
    running = _wait(
        client,
        paused_job["id"],
        lambda item: item["settings"].get("pattern_phase") == "related"
        and (item.get("error_message") or "").startswith("Related items:"),
        timeout=8,
    )
    assert running["error_message"].startswith("Related items:")
    paused = client.post(f"/api/jobs/{running['id']}/pause")
    assert paused.status_code == 200
    assert paused.json()["status"] == "paused"
    time.sleep(0.4)
    assert client.get(f"/api/jobs/{running['id']}").json()["status"] == "paused"
    resumed = client.post(f"/api/jobs/{running['id']}/resume")
    assert resumed.status_code == 200
    finished = _wait(
        client,
        running["id"],
        lambda item: item["status"] == "blocked",
        timeout=20,
    )
    assert finished["settings"]["related_visited"] == 3
    related = client.get(f"/api/jobs/{finished['id']}/observations").json()
    assert any(item["source"] == "related" for item in related["items"])

    stopped_job = _related(client, limit=3, delay_sec=3, recheck=True)
    _wait(
        client,
        stopped_job["id"],
        lambda item: item["settings"].get("pattern_phase") == "related"
        and (item.get("error_message") or "").startswith("Related items:"),
    )
    stopped = client.post(f"/api/jobs/{stopped_job['id']}/stop")
    assert stopped.status_code == 200
    body = stopped.json()
    assert body["status"] == "completed"
    assert body["error_message"] == "Stopped by operator"
    assert body["settings"]["stopped_by_operator"] is True
    time.sleep(0.6)
    settled = client.get(f"/api/jobs/{stopped_job['id']}").json()
    assert settled["status"] == "completed"
    assert settled["settings"].get("recheck_outcome") in {None, ""}
    assert settled["status"] != "blocked"
