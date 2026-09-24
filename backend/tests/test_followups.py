import time
from urllib.parse import unquote

from app.followups import suggest


def _wait(client, job_id, predicate, timeout=8):
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        last = client.get(f"/api/jobs/{job_id}").json()
        if predicate(last):
            return last
        time.sleep(0.05)
    raise AssertionError(last)


def _fixture(client, fixture_set="pokemon"):
    response = client.post(
        "/api/jobs",
        json={
            "mode": "fixture",
            "fixture_set": fixture_set,
            "search_query": "Pokemon cards",
            "search_terms": "pokemon cards|fixture",
            "max_pages": 2,
            "delay_sec": 0,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_suggestions_skip_the_parents_own_slice():
    job = {
        "id": 7,
        "status": "blocked",
        "start_url": "https://www.amazon.com/s?k=pokemon+cards&rh=p_36%3A2500-5000&s=price-asc-rank",
        "search_query": "pokemon cards",
        "search_terms": "pokemon cards",
        "settings": {
            "min_price": 25,
            "max_price": 50,
            "department": "all",
            "mode": "url",
        },
    }
    ideas = {item["id"]: item for item in suggest(job)}
    assert "price:25-50" not in ideas
    assert "price:under-25" not in ideas
    assert "price:100-plus" not in ideas
    assert "sort:price-asc" not in ideas
    assert ideas["sort:featured"]["start_url"].startswith("https://www.amazon.com/")
    assert "s=" not in ideas["sort:featured"]["start_url"]
    assert "price-asc-rank" not in ideas["sort:featured"]["start_url"]


def test_followup_jobs_link_to_a_blocked_parent(client):
    blocked = _wait(
        client,
        _fixture(client, "captcha")["id"],
        lambda item: item["status"] == "blocked",
    )
    listed = client.get(f"/api/jobs/{blocked['id']}/follow-ups")
    assert listed.status_code == 200, listed.text
    ids = [item["id"] for item in listed.json()["suggestions"]]
    assert "price:under-25" in ids
    assert "sort:price-asc" in ids
    assert "sort:newest" in ids
    assert "sort:featured" not in ids

    created = client.post(
        f"/api/jobs/{blocked['id']}/follow-ups",
        json={"suggestion_ids": ["price:under-25", "sort:newest"]},
    )
    assert created.status_code == 201, created.text
    jobs = created.json()["jobs"]
    assert len(jobs) == 2
    for job in jobs:
        assert job["parent_job_id"] == blocked["id"]
        assert "|follow-up|" in job["search_terms"]
        assert f"|parent:{blocked['id']}" in job["search_terms"]
        assert job["settings"]["mode"] == "search"
        assert job["settings"]["fixture_set"] is None
        assert job["settings"]["proxy_password"] == ""
        assert job["start_url"].startswith("https://www.amazon.com/s?")

    under = next(job for job in jobs if "price:under-25" in job["search_terms"])
    newest = next(job for job in jobs if "sort:newest" in job["search_terms"])
    assert "p_36:0-2500" in unquote(under["start_url"])
    assert "date-desc-rank" in newest["start_url"]

    not_blocked = client.get(f"/api/jobs/{under['id']}/follow-ups")
    assert not_blocked.status_code == 409
    missing = client.post(
        f"/api/jobs/{blocked['id']}/follow-ups",
        json={"suggestion_ids": ["price:nope"]},
    )
    assert missing.status_code == 400
