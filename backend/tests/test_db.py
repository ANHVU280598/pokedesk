import json
import sqlite3

import pytest

from app import db


def _job(database):
    return db.create_job(
        start_url="https://www.amazon.com/s?k=pokemon",
        search_query="pokemon cards",
        search_terms="pokemon cards|booster box",
        settings={"max_pages": 2, "delay_ms": 1000, "headless": True},
    )


def _card(**overrides):
    payload = {
        "asin": "B0PKMN0001",
        "title": "Booster Box",
        "image_url": "https://img.example/a.jpg",
        "product_url": "https://www.amazon.com/dp/B0PKMN0001",
        "category_breadcrumbs": "Toys",
        "price": 20.0,
        "currency": "USD",
        "list_price": 25.0,
        "rating": 4.5,
        "review_count": 10,
        "badges": ["Best Seller"],
        "availability_snippet": "Only 2 left in stock",
        "seller": "Amazon",
        "page_number": 1,
        "page_url": "https://www.amazon.com/s?k=pokemon",
    }
    payload.update(overrides)
    return payload


def test_schema_accepts_blocked_and_rejects_unknown_status(database):
    conn = sqlite3.connect(database)
    sql = conn.execute(
        "SELECT sql FROM sqlite_master WHERE name = 'scrape_jobs'"
    ).fetchone()[0]
    assert "blocked" in sql
    conn.execute(
        """
        INSERT INTO scrape_jobs (
          status, settings_json, created_at, updated_at
        ) VALUES ('blocked', '{}', 't', 't')
        """
    )
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute(
            """
            INSERT INTO scrape_jobs (
              status, settings_json, created_at, updated_at
            ) VALUES ('nope', '{}', 't', 't')
            """
        )
    conn.close()


def test_asin_upsert_keeps_one_product_and_one_observation(database):
    job = _job(database)
    db.upsert_card(job["id"], _card(title="First title", price=20))
    db.upsert_card(job["id"], _card(title="Second title", price=18.5, page_number=2))

    conn = sqlite3.connect(database)
    conn.row_factory = sqlite3.Row
    products = conn.execute("SELECT * FROM products").fetchall()
    observations = conn.execute("SELECT * FROM scrape_observations").fetchall()
    assert len(products) == 1
    assert products[0]["title"] == "Second title"
    assert products[0]["first_seen_at"] == products[0]["created_at"]
    assert len(observations) == 1
    assert observations[0]["price"] == 18.5
    assert observations[0]["page_number"] == 2
    raw = json.loads(observations[0]["raw_json"])
    assert raw["title"] == "Second title"
    assert json.loads(observations[0]["badges_json"]) == ["Best Seller"]
    conn.close()

    listed = db.list_observations(job["id"])
    assert listed["total"] == 1
    assert listed["items"][0]["price"] == 18.5


def test_same_asin_in_two_jobs_keeps_two_observations(database):
    first = _job(database)
    second = db.create_job(
        start_url="https://www.amazon.com/s?k=pokemon&page=later",
        search_query="pokemon cards",
        search_terms="pokemon cards",
        settings={"max_pages": 1, "delay_ms": 0, "headless": True},
    )
    db.upsert_card(first["id"], _card(price=10))
    db.upsert_card(second["id"], _card(price=12))
    conn = sqlite3.connect(database)
    assert conn.execute("SELECT COUNT(*) FROM products").fetchone()[0] == 1
    assert conn.execute("SELECT COUNT(*) FROM scrape_observations").fetchone()[0] == 2
    conn.close()


def test_null_asins_do_not_collapse_unless_url_matches(database):
    job = _job(database)
    db.upsert_card(job["id"], _card(asin=None, product_url="https://www.amazon.com/a", title="A"))
    db.upsert_card(job["id"], _card(asin=None, product_url="https://www.amazon.com/b", title="B"))
    db.upsert_card(job["id"], _card(asin=None, product_url="https://www.amazon.com/a", title="A2", price=9))
    conn = sqlite3.connect(database)
    assert conn.execute("SELECT COUNT(*) FROM products WHERE asin IS NULL").fetchone()[0] == 2
    rows = conn.execute(
        """
        SELECT p.title, o.price FROM scrape_observations o
        JOIN products p ON p.id = o.product_id
        WHERE p.product_url = 'https://www.amazon.com/a'
        """
    ).fetchall()
    assert rows == [("A2", 9)]
    conn.close()


def test_delete_job_cascades_observations(database):
    job = _job(database)
    db.upsert_card(job["id"], _card())
    db.add_snapshot(job["id"], 1, "https://www.amazon.com/s?k=pokemon", 1)
    db.add_snapshot(job["id"], 1, "https://www.amazon.com/s?k=pokemon&page=1", 1)
    conn = sqlite3.connect(database)
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("DELETE FROM scrape_jobs WHERE id = ?", (job["id"],))
    conn.commit()
    assert conn.execute("SELECT COUNT(*) FROM scrape_observations").fetchone()[0] == 0
    assert conn.execute("SELECT COUNT(*) FROM page_snapshots").fetchone()[0] == 0
    assert conn.execute("SELECT COUNT(*) FROM products").fetchone()[0] == 1
    conn.close()


def test_claim_queue_order(database):
    first = _job(database)
    second = db.create_job(
        start_url="fixture://pokemon/1",
        search_query=None,
        search_terms=None,
        settings={"max_pages": 1, "delay_ms": 0, "headless": True, "mode": "fixture"},
    )
    assert db.claim_next_queued() == first["id"]
    assert db.get_status(first["id"]) == "running"
    assert db.claim_next_queued() == second["id"]
    assert db.claim_next_queued() is None


def test_asin_attaches_to_one_null_row_by_url_or_title(database):
    job = _job(database)
    by_url = db.upsert_card(
        job["id"],
        _card(
            asin=None,
            title="Charizard ex Ultra Premium",
            product_url="https://www.amazon.com/loose-charizard",
        ),
    )
    attached = db.upsert_card(
        job["id"],
        _card(
            asin="B0ATTACH01",
            title="Charizard ex Ultra Premium",
            product_url="https://www.amazon.com/loose-charizard",
            price=39,
        ),
    )
    assert attached == by_url
    assert db.get_product(by_url)["asin"] == "B0ATTACH01"

    other = _job(database)
    left = db.upsert_card(
        other["id"],
        _card(asin=None, title="Unique Blastoise Binder Set", product_url="https://www.amazon.com/a"),
    )
    right = db.upsert_card(
        other["id"],
        _card(asin=None, title="Unique Blastoise Binder Set", product_url="https://www.amazon.com/b"),
    )
    fresh = db.upsert_card(
        other["id"],
        _card(
            asin="B0ATTACH02",
            title="Unique Blastoise Binder Set",
            product_url="https://www.amazon.com/c",
        ),
    )
    assert left != right
    assert fresh not in {left, right}
    assert db.get_product(fresh)["asin"] == "B0ATTACH02"
