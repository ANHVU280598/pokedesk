import json
import os
import time

from app import db
from app.service import playwright_proxy


def _wait(client, job_id, predicate, timeout=8):
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        last = client.get(f"/api/jobs/{job_id}").json()
        if predicate(last):
            return last
        time.sleep(0.05)
    raise AssertionError(last)


def _completed(client):
    created = client.post(
        "/api/jobs",
        json={
            "mode": "fixture",
            "fixture_set": "pokemon",
            "search_query": "Pokemon cards",
            "max_pages": 2,
            "delay_sec": 0,
            "expand_related": False,
            "recheck_after_block": False,
        },
    )
    assert created.status_code == 201, created.text
    return _wait(client, created.json()["id"], lambda item: item["status"] == "completed")


def test_proxy_settings_are_persisted_and_masked(client):
    saved = client.put(
        "/api/settings",
        json={
            "delay_sec": 2.5,
            "max_pages": 3,
            "headless": True,
            "proxy_enabled": True,
            "proxy_url": "socks5://127.0.0.1:1080",
            "proxy_username": "desk",
            "proxy_password": "s3cret",
        },
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["proxy_password"] == ""
    assert saved.json()["proxy_password_set"] is True
    assert saved.json()["proxy_url"] == "socks5://127.0.0.1:1080"

    stored = json.loads(open(os.environ["SCRAPE_SETTINGS_PATH"], encoding="utf-8").read())
    assert stored["proxy_password"] == "s3cret"

    kept = client.put(
        "/api/settings",
        json={
            "delay_sec": 3,
            "max_pages": 3,
            "headless": True,
            "proxy_enabled": True,
            "proxy_url": "socks5://127.0.0.1:1080",
            "proxy_username": "desk",
            "proxy_password": "",
        },
    )
    assert kept.status_code == 200
    assert kept.json()["proxy_password_set"] is True
    assert kept.json()["delay_sec"] == 3
    stored = json.loads(open(os.environ["SCRAPE_SETTINGS_PATH"], encoding="utf-8").read())
    assert stored["proxy_password"] == "s3cret"

    cleared = client.put(
        "/api/settings",
        json={
            "delay_sec": 3,
            "max_pages": 3,
            "headless": True,
            "proxy_enabled": False,
            "proxy_url": "socks5://127.0.0.1:1080",
            "proxy_username": "desk",
            "proxy_password": "",
            "clear_proxy_password": True,
        },
    )
    assert cleared.json()["proxy_password_set"] is False
    stored = json.loads(open(os.environ["SCRAPE_SETTINGS_PATH"], encoding="utf-8").read())
    assert stored["proxy_password"] == ""

    bad = client.put(
        "/api/settings",
        json={
            "delay_sec": 3,
            "max_pages": 3,
            "headless": True,
            "proxy_enabled": True,
            "proxy_url": "ftp://127.0.0.1:9",
        },
    )
    assert bad.status_code == 400


def test_playwright_proxy_is_live_only():
    assert (
        playwright_proxy(
            {
                "mode": "fixture",
                "proxy_enabled": True,
                "proxy_url": "http://127.0.0.1:8888",
                "proxy_password": "nope",
            }
        )
        is None
    )
    config = playwright_proxy(
        {
            "mode": "search",
            "proxy_enabled": True,
            "proxy_url": "http://user:secret@127.0.0.1:8888",
            "proxy_username": "desk",
            "proxy_password": "s3cret",
        }
    )
    assert config == {
        "server": "http://127.0.0.1:8888",
        "username": "desk",
        "password": "s3cret",
    }


def test_product_edit_api(client):
    job = _completed(client)
    observations = client.get(f"/api/jobs/{job['id']}/observations").json()
    product_id = observations["items"][0]["product_id"]
    asin = observations["items"][0]["asin"]
    patched = client.patch(
        f"/api/products/{product_id}",
        json={
            "title": "Edited booster",
            "asin": asin,
            "image_url": "https://img.example/edited.jpg",
            "product_url": f"https://www.amazon.com/dp/{asin}",
            "category_breadcrumbs": "Toys & Games > Edited",
        },
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["title"] == "Edited booster"
    assert patched.json()["category_breadcrumbs"] == "Toys & Games > Edited"
    loaded = client.get(f"/api/products/{product_id}")
    assert loaded.json()["title"] == "Edited booster"
    assert loaded.json()["image_url"] == "https://img.example/edited.jpg"

    clash = client.patch(
        f"/api/products/{product_id}",
        json={"title": "Edited booster", "asin": "NOT-AN-ASIN"},
    )
    assert clash.status_code == 400
    blocked = client.delete(f"/api/products/{product_id}")
    assert blocked.status_code == 409


def test_merge_reassigns_observations(client):
    first = _completed(client)
    second = _completed(client)
    keep = db.upsert_card(
        second["id"],
        {
            "title": "Pikachu V Collection Box",
            "asin": "B0MERGE123",
            "product_url": "https://www.amazon.com/dp/B0MERGE123",
            "price": 22,
            "currency": "USD",
            "page_number": 1,
        },
    )
    drop = db.upsert_card(
        first["id"],
        {
            "title": "Pikachu V Collection Box",
            "product_url": "https://www.amazon.com/loose-pikachu",
            "image_url": "https://img.example/loose.jpg",
            "price": 18,
            "currency": "USD",
            "page_number": 1,
        },
    )
    assert keep != drop
    merged = client.post("/api/products/merge", json={"keep_id": keep, "drop_id": drop})
    assert merged.status_code == 200, merged.text
    body = merged.json()
    assert body["id"] == keep
    assert body["asin"] == "B0MERGE123"
    assert body["image_url"] == "https://img.example/loose.jpg"
    job_ids = {item["job_id"] for item in body["observations"]}
    assert first["id"] in job_ids
    assert second["id"] in job_ids
    assert client.get(f"/api/products/{drop}").status_code == 404

    prices = {
        item["job_id"]: item["price"]
        for item in body["observations"]
        if item["job_id"] in {first["id"], second["id"]}
    }
    assert prices[first["id"]] == 18
    assert prices[second["id"]] == 22
