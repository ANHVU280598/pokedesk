"""SQLite ledger. One connection, short transactions, foreign keys on."""

from __future__ import annotations

import json
import re
import sqlite3
import threading
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

SCHEMA_PATH = Path(__file__).resolve().parent / "schema.sql"

_lock = threading.RLock()
_conn: sqlite3.Connection | None = None


class JobStateError(Exception):
    """The job exists but the requested transition is not allowed."""


def utcnow() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def init_db(path: Path) -> None:
    global _conn
    with _lock:
        if _conn is not None:
            _conn.close()
            _conn = None
        path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(path, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        conn.execute("PRAGMA journal_mode = WAL")
        conn.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
        conn.execute("PRAGMA foreign_keys = ON")
        _conn = conn


def close_db() -> None:
    global _conn
    with _lock:
        if _conn is not None:
            _conn.close()
            _conn = None


@contextmanager
def _tx():
    if _conn is None:
        raise RuntimeError("Database is not initialized")
    with _lock:
        try:
            yield _conn
            _conn.commit()
        except Exception:
            _conn.rollback()
            raise


def _settings(row: sqlite3.Row) -> dict:
    try:
        data = json.loads(row["settings_json"] or "{}")
    except json.JSONDecodeError:
        return {}
    return data if isinstance(data, dict) else {}


def _job_dict(row: sqlite3.Row) -> dict:
    data = dict(row)
    data["settings"] = _settings(row)
    data.pop("settings_json", None)
    return data


def _get(conn: sqlite3.Connection, job_id: int) -> sqlite3.Row | None:
    return conn.execute("SELECT * FROM scrape_jobs WHERE id = ?", (job_id,)).fetchone()


def _count_obs(conn: sqlite3.Connection, job_id: int) -> int:
    row = conn.execute(
        "SELECT COUNT(*) AS n FROM scrape_observations WHERE job_id = ?",
        (job_id,),
    ).fetchone()
    return int(row["n"])


def create_job(
    *,
    start_url: str | None,
    search_query: str | None,
    search_terms: str | None,
    settings: dict,
) -> dict:
    now = utcnow()
    with _tx() as conn:
        cur = conn.execute(
            """
            INSERT INTO scrape_jobs (
              start_url, search_query, search_terms, status, pagination_mode,
              pages_visited, items_scraped, settings_json, created_at, updated_at
            ) VALUES (?, ?, ?, 'queued', 'unknown', 0, 0, ?, ?, ?)
            """,
            (start_url, search_query, search_terms, json.dumps(settings), now, now),
        )
        row = _get(conn, int(cur.lastrowid))
        assert row is not None
        return _job_dict(row)


def get_job(job_id: int) -> dict | None:
    with _tx() as conn:
        row = _get(conn, job_id)
        return None if row is None else _job_dict(row)


def list_jobs(limit: int = 100) -> list[dict]:
    with _tx() as conn:
        rows = conn.execute(
            """
            SELECT * FROM scrape_jobs
            ORDER BY created_at DESC, id DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
        return [_job_dict(row) for row in rows]


def get_status(job_id: int) -> str | None:
    with _tx() as conn:
        row = conn.execute(
            "SELECT status FROM scrape_jobs WHERE id = ?",
            (job_id,),
        ).fetchone()
        return None if row is None else row["status"]


def claim_next_queued() -> int | None:
    now = utcnow()
    with _tx() as conn:
        row = conn.execute(
            """
            SELECT id FROM scrape_jobs
            WHERE status = 'queued'
            ORDER BY created_at ASC, id ASC
            LIMIT 1
            """
        ).fetchone()
        if row is None:
            return None
        cur = conn.execute(
            """
            UPDATE scrape_jobs
            SET status = 'running',
                started_at = COALESCE(started_at, ?),
                updated_at = ?
            WHERE id = ? AND status = 'queued'
            """,
            (now, now, row["id"]),
        )
        if cur.rowcount != 1:
            return None
        return int(row["id"])


def fail_interrupted() -> None:
    now = utcnow()
    message = "Worker stopped while this job was running. Results so far were kept."
    with _tx() as conn:
        rows = conn.execute(
            "SELECT id FROM scrape_jobs WHERE status = 'running'"
        ).fetchall()
        for row in rows:
            items = _count_obs(conn, row["id"])
            conn.execute(
                """
                UPDATE scrape_jobs
                SET status = 'failed',
                    error_message = ?,
                    finished_at = ?,
                    items_scraped = ?,
                    updated_at = ?
                WHERE id = ? AND status = 'running'
                """,
                (message, now, items, now, row["id"]),
            )


def pause_job(job_id: int) -> dict:
    now = utcnow()
    with _tx() as conn:
        row = _get(conn, job_id)
        if row is None:
            raise LookupError(job_id)
        if row["status"] != "running":
            raise JobStateError("Only a running job can be paused")
        conn.execute(
            """
            UPDATE scrape_jobs SET status = 'paused', updated_at = ?
            WHERE id = ? AND status = 'running'
            """,
            (now, job_id),
        )
        updated = _get(conn, job_id)
        assert updated is not None
        return _job_dict(updated)


def resume_job(job_id: int, *, requeue: bool) -> dict:
    now = utcnow()
    new_status = "queued" if requeue else "running"
    with _tx() as conn:
        row = _get(conn, job_id)
        if row is None:
            raise LookupError(job_id)
        if row["status"] != "paused":
            raise JobStateError("Only a paused job can be resumed")
        conn.execute(
            """
            UPDATE scrape_jobs SET status = ?, updated_at = ?
            WHERE id = ? AND status = 'paused'
            """,
            (new_status, now, job_id),
        )
        updated = _get(conn, job_id)
        assert updated is not None
        return _job_dict(updated)


def stop_job(job_id: int) -> dict:
    now = utcnow()
    with _tx() as conn:
        row = _get(conn, job_id)
        if row is None:
            raise LookupError(job_id)
        status = row["status"]
        settings = _settings(row)
        if status in {"queued", "running", "paused"}:
            settings["stopped_by_operator"] = True
            conn.execute(
                """
                UPDATE scrape_jobs
                SET status = 'completed',
                    finished_at = ?,
                    error_message = ?,
                    settings_json = ?,
                    updated_at = ?,
                    items_scraped = ?
                WHERE id = ?
                """,
                (
                    now,
                    "Stopped by operator",
                    json.dumps(settings),
                    now,
                    _count_obs(conn, job_id),
                    job_id,
                ),
            )
        elif status == "blocked":
            settings["block_acknowledged"] = True
            conn.execute(
                """
                UPDATE scrape_jobs
                SET finished_at = COALESCE(finished_at, ?),
                    settings_json = ?,
                    updated_at = ?
                WHERE id = ?
                """,
                (now, json.dumps(settings), now, job_id),
            )
        else:
            raise JobStateError("This job is already finished")
        updated = _get(conn, job_id)
        assert updated is not None
        return _job_dict(updated)


def queue_retry(job_id: int, wait_sec: float) -> dict:
    now = utcnow()
    with _tx() as conn:
        row = _get(conn, job_id)
        if row is None:
            raise LookupError(job_id)
        if row["status"] != "blocked":
            raise JobStateError("Only a blocked job can be retried")
        settings = _settings(row)
        settings["retry_wait_sec"] = wait_sec
        settings["block_acknowledged"] = False
        conn.execute(
            """
            UPDATE scrape_jobs
            SET status = 'queued',
                finished_at = NULL,
                error_message = ?,
                settings_json = ?,
                updated_at = ?
            WHERE id = ? AND status = 'blocked'
            """,
            (
                "Waiting to retry after a soft block",
                json.dumps(settings),
                now,
                job_id,
            ),
        )
        updated = _get(conn, job_id)
        assert updated is not None
        return _job_dict(updated)


def merge_settings(job_id: int, patch: dict) -> None:
    now = utcnow()
    with _tx() as conn:
        row = _get(conn, job_id)
        if row is None:
            return
        settings = _settings(row)
        settings.update(patch)
        conn.execute(
            "UPDATE scrape_jobs SET settings_json = ?, updated_at = ? WHERE id = ?",
            (json.dumps(settings), now, job_id),
        )


def set_error_message_if_running(job_id: int, message: str | None) -> None:
    now = utcnow()
    with _tx() as conn:
        conn.execute(
            """
            UPDATE scrape_jobs SET error_message = ?, updated_at = ?
            WHERE id = ? AND status = 'running'
            """,
            (message, now, job_id),
        )


def record_page(
    job_id: int,
    *,
    page_num: int,
    detected_mode: str,
    next_page_number: int,
    resume_url: str | None,
) -> None:
    """Store progress without changing a terminal status."""
    now = utcnow()
    with _tx() as conn:
        row = _get(conn, job_id)
        if row is None:
            return
        settings = _settings(row)
        settings["next_page_number"] = next_page_number
        if resume_url:
            settings["resume_url"] = resume_url
        mode = row["pagination_mode"]
        if detected_mode in {"next_page", "show_more"}:
            mode = detected_mode
        items = _count_obs(conn, job_id)
        if row["status"] == "running":
            conn.execute(
                """
                UPDATE scrape_jobs
                SET pages_visited = ?,
                    items_scraped = ?,
                    pagination_mode = ?,
                    settings_json = ?,
                    error_message = NULL,
                    updated_at = ?
                WHERE id = ?
                """,
                (page_num, items, mode, json.dumps(settings), now, job_id),
            )
        else:
            conn.execute(
                """
                UPDATE scrape_jobs
                SET pages_visited = ?,
                    items_scraped = ?,
                    pagination_mode = ?,
                    settings_json = ?,
                    updated_at = ?
                WHERE id = ?
                """,
                (page_num, items, mode, json.dumps(settings), now, job_id),
            )


def mark_blocked(
    job_id: int,
    *,
    pages_visited: int,
    resume_url: str | None,
    next_page_number: int,
    message: str,
) -> bool:
    now = utcnow()
    with _tx() as conn:
        row = _get(conn, job_id)
        if row is None or row["status"] not in {"running", "paused"}:
            return False
        settings = _settings(row)
        settings["resume_url"] = resume_url
        settings["next_page_number"] = next_page_number
        settings["block_acknowledged"] = False
        conn.execute(
            """
            UPDATE scrape_jobs
            SET status = 'blocked',
                pages_visited = ?,
                items_scraped = ?,
                error_message = ?,
                finished_at = ?,
                settings_json = ?,
                updated_at = ?
            WHERE id = ? AND status IN ('running', 'paused')
            """,
            (
                pages_visited,
                _count_obs(conn, job_id),
                message,
                now,
                json.dumps(settings),
                now,
                job_id,
            ),
        )
        return True


def finish_if_running(job_id: int, status: str, message: str | None) -> bool:
    if status not in {"completed", "failed", "blocked"}:
        raise ValueError(f"Unsupported finish status: {status}")
    now = utcnow()
    with _tx() as conn:
        row = _get(conn, job_id)
        if row is None or row["status"] != "running":
            return False
        conn.execute(
            """
            UPDATE scrape_jobs
            SET status = ?,
                error_message = ?,
                finished_at = ?,
                items_scraped = ?,
                updated_at = ?
            WHERE id = ? AND status = 'running'
            """,
            (status, message, now, _count_obs(conn, job_id), now, job_id),
        )
        return True


def add_snapshot(job_id: int, page_number: int, url: str, items_found: int) -> None:
    now = utcnow()
    with _tx() as conn:
        conn.execute(
            """
            INSERT INTO page_snapshots (job_id, page_number, url, items_found, scraped_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(job_id, page_number) DO UPDATE SET
              url = excluded.url,
              items_found = excluded.items_found,
              scraped_at = excluded.scraped_at
            """,
            (job_id, page_number, url, items_found, now),
        )


def upsert_card(job_id: int, card: dict) -> int:
    title = " ".join((card.get("title") or "").split())
    if not title:
        raise ValueError("Card title is required")
    asin = (card.get("asin") or "").strip().upper() or None
    if asin and not re.fullmatch(r"[A-Z0-9]{10}", asin):
        asin = None
    now = utcnow()
    with _tx() as conn:
        product_id = _upsert_product(conn, card, asin, title, now)
        _upsert_observation(conn, job_id, product_id, card, now)
        return product_id


def _upsert_product(
    conn: sqlite3.Connection,
    card: dict,
    asin: str | None,
    title: str,
    now: str,
) -> int:
    image = card.get("image_url")
    url = card.get("product_url")
    crumbs = card.get("category_breadcrumbs")
    if asin:
        row = conn.execute(
            """
            INSERT INTO products (
              asin, title, image_url, product_url, category_breadcrumbs,
              first_seen_at, last_seen_at, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(asin) WHERE asin IS NOT NULL DO UPDATE SET
              title = excluded.title,
              image_url = COALESCE(excluded.image_url, products.image_url),
              product_url = COALESCE(excluded.product_url, products.product_url),
              category_breadcrumbs = COALESCE(excluded.category_breadcrumbs, products.category_breadcrumbs),
              last_seen_at = excluded.last_seen_at,
              updated_at = excluded.updated_at
            RETURNING id
            """,
            (asin, title, image, url, crumbs, now, now, now, now),
        ).fetchone()
        return int(row["id"])
    if url:
        existing = conn.execute(
            "SELECT id FROM products WHERE asin IS NULL AND product_url = ?",
            (url,),
        ).fetchone()
        if existing:
            conn.execute(
                """
                UPDATE products
                SET title = ?,
                    image_url = COALESCE(?, image_url),
                    category_breadcrumbs = COALESCE(?, category_breadcrumbs),
                    last_seen_at = ?,
                    updated_at = ?
                WHERE id = ?
                """,
                (title, image, crumbs, now, now, existing["id"]),
            )
            return int(existing["id"])
    row = conn.execute(
        """
        INSERT INTO products (
          asin, title, image_url, product_url, category_breadcrumbs,
          first_seen_at, last_seen_at, created_at, updated_at
        ) VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, ?)
        RETURNING id
        """,
        (title, image, url, crumbs, now, now, now, now),
    ).fetchone()
    return int(row["id"])


def _upsert_observation(
    conn: sqlite3.Connection,
    job_id: int,
    product_id: int,
    card: dict,
    now: str,
) -> None:
    badges = card.get("badges") or []
    raw = dict(card)
    raw["observed_at"] = now
    conn.execute(
        """
        INSERT INTO scrape_observations (
          job_id, product_id, price, currency, list_price, rating, review_count,
          badges_json, availability_snippet, seller, raw_json, observed_at, page_number
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(job_id, product_id) DO UPDATE SET
          price = excluded.price,
          currency = excluded.currency,
          list_price = excluded.list_price,
          rating = excluded.rating,
          review_count = excluded.review_count,
          badges_json = excluded.badges_json,
          availability_snippet = excluded.availability_snippet,
          seller = excluded.seller,
          raw_json = excluded.raw_json,
          observed_at = excluded.observed_at,
          page_number = excluded.page_number
        """,
        (
            job_id,
            product_id,
            card.get("price"),
            card.get("currency"),
            card.get("list_price"),
            card.get("rating"),
            card.get("review_count"),
            json.dumps(badges) if badges else None,
            card.get("availability_snippet"),
            card.get("seller"),
            json.dumps(raw),
            now,
            card.get("page_number"),
        ),
    )


def list_observations(
    job_id: int,
    *,
    q: str | None = None,
    min_price: float | None = None,
    max_price: float | None = None,
    min_rating: float | None = None,
    sort: str = "page",
    limit: int = 500,
    offset: int = 0,
) -> dict:
    order = {
        "page": "o.page_number ASC, o.id ASC",
        "recent": "o.observed_at DESC, o.id DESC",
        "price_asc": "o.price IS NULL, o.price ASC, o.id ASC",
        "price_desc": "o.price IS NULL, o.price DESC, o.id ASC",
        "rating": "o.rating IS NULL, o.rating DESC, o.id ASC",
    }[sort]
    where = ["o.job_id = ?"]
    args: list = [job_id]
    if q:
        like = f"%{_escape_like(q)}%"
        where.append(
            "(p.title LIKE ? ESCAPE '\\' OR IFNULL(p.asin, '') LIKE ? ESCAPE '\\')"
        )
        args.extend([like, like])
    if min_price is not None:
        where.append("o.price >= ?")
        args.append(min_price)
    if max_price is not None:
        where.append("o.price <= ?")
        args.append(max_price)
    if min_rating is not None:
        where.append("o.rating >= ?")
        args.append(min_rating)
    clause = " AND ".join(where)
    with _tx() as conn:
        total = conn.execute(
            f"""
            SELECT COUNT(*) AS n
            FROM scrape_observations o
            JOIN products p ON p.id = o.product_id
            WHERE {clause}
            """,
            args,
        ).fetchone()["n"]
        rows = conn.execute(
            f"""
            SELECT o.id AS observation_id, o.job_id, o.product_id, o.price, o.currency,
                   o.list_price, o.rating, o.review_count, o.badges_json,
                   o.availability_snippet, o.seller, o.observed_at, o.page_number,
                   p.asin, p.title, p.image_url, p.product_url, p.category_breadcrumbs
            FROM scrape_observations o
            JOIN products p ON p.id = o.product_id
            WHERE {clause}
            ORDER BY {order}
            LIMIT ? OFFSET ?
            """,
            [*args, limit, offset],
        ).fetchall()
    items = []
    for row in rows:
        item = dict(row)
        item["badges"] = _badges(item.pop("badges_json"))
        items.append(item)
    return {"job_id": job_id, "total": int(total), "items": items}


def get_product(product_id: int) -> dict | None:
    with _tx() as conn:
        row = conn.execute("SELECT * FROM products WHERE id = ?", (product_id,)).fetchone()
        if row is None:
            return None
        observations = conn.execute(
            """
            SELECT id AS observation_id, job_id, price, currency, list_price, rating,
                   review_count, badges_json, availability_snippet, seller,
                   observed_at, page_number
            FROM scrape_observations
            WHERE product_id = ?
            ORDER BY observed_at DESC, id DESC
            LIMIT 20
            """,
            (product_id,),
        ).fetchall()
    product = dict(row)
    history = []
    for obs in observations:
        item = dict(obs)
        item["badges"] = _badges(item.pop("badges_json"))
        history.append(item)
    product["observations"] = history
    return product


def _badges(raw: str | None) -> list:
    if not raw:
        return []
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return []
    return data if isinstance(data, list) else []


def _escape_like(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
