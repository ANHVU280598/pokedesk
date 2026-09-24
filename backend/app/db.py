"""SQLite ledger. One connection, short transactions, foreign keys on."""

from __future__ import annotations

import json
import re
import sqlite3
import threading
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path

SCHEMA_PATH = Path(__file__).resolve().parent / "schema.sql"

_lock = threading.RLock()
_conn: sqlite3.Connection | None = None


class JobStateError(Exception):
    """The job exists but the requested transition is not allowed."""


class CatalogError(Exception):
    """A catalog edit conflicts with the ledger (merge, delete, or ASIN)."""


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
        _migrate(conn)
        conn.commit()
        _conn = conn


def _migrate(conn: sqlite3.Connection) -> None:
    columns = {row["name"] for row in conn.execute("PRAGMA table_info(scrape_jobs)")}
    if "parent_job_id" not in columns:
        conn.execute(
            "ALTER TABLE scrape_jobs ADD COLUMN parent_job_id INTEGER "
            "REFERENCES scrape_jobs(id) ON DELETE SET NULL"
        )
    if "queue_at" not in columns:
        conn.execute("ALTER TABLE scrape_jobs ADD COLUMN queue_at TEXT")
    obs_columns = {row["name"] for row in conn.execute("PRAGMA table_info(scrape_observations)")}
    if "source" not in obs_columns:
        conn.execute(
            "ALTER TABLE scrape_observations ADD COLUMN source TEXT NOT NULL DEFAULT 'results'"
        )
    if "bought_past_month" not in obs_columns:
        conn.execute(
            "ALTER TABLE scrape_observations ADD COLUMN bought_past_month INTEGER"
        )
    if "bought_past_month_text" not in obs_columns:
        conn.execute(
            "ALTER TABLE scrape_observations ADD COLUMN bought_past_month_text TEXT"
        )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS ix_jobs_parent ON scrape_jobs(parent_job_id)"
    )


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
    parent_job_id: int | None = None,
) -> dict:
    now = utcnow()
    with _tx() as conn:
        cur = conn.execute(
            """
            INSERT INTO scrape_jobs (
              start_url, search_query, search_terms, status, pagination_mode,
              pages_visited, items_scraped, settings_json, created_at, updated_at,
              parent_job_id, queue_at
            ) VALUES (?, ?, ?, 'queued', 'unknown', 0, 0, ?, ?, ?, ?, ?)
            """,
            (
                start_url,
                search_query,
                search_terms,
                json.dumps(settings),
                now,
                now,
                parent_job_id,
                now,
            ),
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
            ORDER BY COALESCE(queue_at, created_at) ASC, id ASC
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


def queue_recheck(job_id: int, patch: dict, wait_sec: float) -> dict:
    """Queue a blocked job to reload its results list or the next page."""
    now = utcnow()
    with _tx() as conn:
        row = _get(conn, job_id)
        if row is None:
            raise LookupError(job_id)
        if row["status"] != "blocked":
            raise JobStateError("Only a blocked job can be rechecked")
        settings = _settings(row)
        settings.update(patch)
        settings["retry_wait_sec"] = wait_sec
        settings["recheck_pending"] = False
        settings["block_acknowledged"] = False
        conn.execute(
            """
            UPDATE scrape_jobs
            SET status = 'queued',
                finished_at = NULL,
                error_message = ?,
                settings_json = ?,
                queue_at = ?,
                updated_at = ?
            WHERE id = ? AND status = 'blocked'
            """,
            (
                "Rechecking this results list for another page.",
                json.dumps(settings),
                _queue_after_open_work(conn),
                now,
                job_id,
            ),
        )
        updated = _get(conn, job_id)
        assert updated is not None
        return _job_dict(updated)


def mark_recheck_pending(job_id: int) -> None:
    merge_settings(job_id, {"recheck_pending": True})


def open_child_count(parent_id: int) -> int:
    with _tx() as conn:
        row = conn.execute(
            """
            SELECT COUNT(*) AS n FROM scrape_jobs
            WHERE parent_job_id = ? AND status IN ('queued', 'running', 'paused')
            """,
            (parent_id,),
        ).fetchone()
        return int(row["n"])


def _queue_after_open_work(conn: sqlite3.Connection) -> str:
    """Sort a recheck behind jobs that are already queued."""
    row = conn.execute(
        """
        SELECT MAX(COALESCE(queue_at, created_at)) AS latest
        FROM scrape_jobs
        WHERE status = 'queued'
        """
    ).fetchone()
    latest = row["latest"] if row else None
    now = utcnow()
    if not latest or latest < now:
        return now
    base = datetime.fromisoformat(latest)
    return (base + timedelta(seconds=1)).replace(microsecond=0).isoformat()


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
        owned = conn.execute(
            "SELECT id FROM products WHERE asin = ?",
            (asin,),
        ).fetchone()
        if owned is None:
            attached = _null_asin_match(conn, title, url)
            if attached is not None:
                conn.execute(
                    """
                    UPDATE products
                    SET asin = ?,
                        title = ?,
                        image_url = COALESCE(?, image_url),
                        product_url = COALESCE(?, product_url),
                        category_breadcrumbs = COALESCE(?, category_breadcrumbs),
                        last_seen_at = ?,
                        updated_at = ?
                    WHERE id = ? AND asin IS NULL
                    """,
                    (asin, title, image, url, crumbs, now, now, attached),
                )
                return attached
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
    source = card.get("source") or "results"
    if source not in {"results", "related"}:
        source = "results"
    raw = dict(card)
    raw["source"] = source
    raw["observed_at"] = now
    existing = conn.execute(
        "SELECT source FROM scrape_observations WHERE job_id = ? AND product_id = ?",
        (job_id, product_id),
    ).fetchone()
    if existing is not None and existing["source"] == "results" and source == "related":
        return
    conn.execute(
        """
        INSERT INTO scrape_observations (
          job_id, product_id, price, currency, list_price, rating, review_count,
          bought_past_month, bought_past_month_text,
          badges_json, availability_snippet, seller, raw_json, observed_at, page_number,
          source
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(job_id, product_id) DO UPDATE SET
          price = excluded.price,
          currency = excluded.currency,
          list_price = excluded.list_price,
          rating = excluded.rating,
          review_count = excluded.review_count,
          bought_past_month = excluded.bought_past_month,
          bought_past_month_text = excluded.bought_past_month_text,
          badges_json = excluded.badges_json,
          availability_snippet = excluded.availability_snippet,
          seller = excluded.seller,
          raw_json = excluded.raw_json,
          observed_at = excluded.observed_at,
          page_number = excluded.page_number,
          source = excluded.source
        """,
        (
            job_id,
            product_id,
            card.get("price"),
            card.get("currency"),
            card.get("list_price"),
            card.get("rating"),
            card.get("review_count"),
            card.get("bought_past_month"),
            card.get("bought_past_month_text"),
            json.dumps(badges) if badges else None,
            card.get("availability_snippet"),
            card.get("seller"),
            json.dumps(raw),
            now,
            card.get("page_number"),
            source,
        ),
    )


def list_observations(
    job_id: int,
    *,
    q: str | None = None,
    min_price: float | None = None,
    max_price: float | None = None,
    min_rating: float | None = None,
    min_bought: int | None = None,
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
        "bought": "o.bought_past_month IS NULL, o.bought_past_month DESC, o.id ASC",
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
    if min_bought is not None:
        where.append("o.bought_past_month >= ?")
        args.append(min_bought)
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
                   o.list_price, o.rating, o.review_count, o.bought_past_month,
                   o.bought_past_month_text, o.badges_json,
                   o.availability_snippet, o.seller, o.observed_at, o.page_number,
                   o.source,
                   p.asin, p.title, p.image_url, p.product_url, p.category_breadcrumbs,
                   m.status AS tcg_status, m.tcg_url, m.tcg_name, m.tcg_set,
                   m.price AS tcg_price, m.currency AS tcg_currency,
                   m.confidence AS tcg_confidence, m.query AS tcg_query
            FROM scrape_observations o
            JOIN products p ON p.id = o.product_id
            LEFT JOIN tcgplayer_matches m ON m.product_id = p.id
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
                   review_count, bought_past_month, bought_past_month_text,
                   badges_json, availability_snippet, seller,
                   observed_at, page_number
            FROM scrape_observations
            WHERE product_id = ?
            ORDER BY observed_at DESC, id DESC
            LIMIT 100
            """,
            (product_id,),
        ).fetchall()
        match = conn.execute(
            "SELECT * FROM tcgplayer_matches WHERE product_id = ?",
            (product_id,),
        ).fetchone()
    product = dict(row)
    history = []
    for obs in observations:
        item = dict(obs)
        item["badges"] = _badges(item.pop("badges_json"))
        history.append(item)
    product["observations"] = history
    product.update(_match_public(match))
    return product


def _match_public(row: sqlite3.Row | None) -> dict:
    if row is None:
        return {
            "tcg_status": None,
            "tcg_url": None,
            "tcg_name": None,
            "tcg_set": None,
            "tcg_price": None,
            "tcg_currency": None,
            "tcg_confidence": None,
            "tcg_query": None,
        }
    return {
        "tcg_status": row["status"],
        "tcg_url": row["tcg_url"],
        "tcg_name": row["tcg_name"],
        "tcg_set": row["tcg_set"],
        "tcg_price": row["price"],
        "tcg_currency": row["currency"],
        "tcg_confidence": row["confidence"],
        "tcg_query": row["query"],
    }


def list_match_products(job_id: int) -> list[dict]:
    with _tx() as conn:
        rows = conn.execute(
            """
            SELECT p.id, p.title
            FROM scrape_observations o
            JOIN products p ON p.id = o.product_id
            WHERE o.job_id = ?
            GROUP BY p.id
            ORDER BY MIN(o.id)
            """,
            (job_id,),
        ).fetchall()
    return [dict(row) for row in rows]


def list_products_by_ids(product_ids: list[int]) -> list[dict]:
    unique: list[int] = []
    seen: set[int] = set()
    for raw in product_ids:
        pid = int(raw)
        if pid in seen:
            continue
        seen.add(pid)
        unique.append(pid)
    if not unique:
        return []
    placeholders = ",".join("?" * len(unique))
    with _tx() as conn:
        rows = conn.execute(
            f"SELECT id, title FROM products WHERE id IN ({placeholders})",
            unique,
        ).fetchall()
    by_id = {int(row["id"]): dict(row) for row in rows}
    return [by_id[pid] for pid in unique if pid in by_id]


def products_are_fixture_only(product_ids: list[int]) -> bool:
    ids = list(dict.fromkeys(int(pid) for pid in product_ids))
    if not ids:
        return False
    placeholders = ",".join("?" * len(ids))
    with _tx() as conn:
        rows = conn.execute(
            f"""
            SELECT o.product_id, j.settings_json
            FROM scrape_observations o
            JOIN scrape_jobs j ON j.id = o.job_id
            WHERE o.product_id IN ({placeholders})
            """,
            ids,
        ).fetchall()
    modes: dict[int, set[str]] = {pid: set() for pid in ids}
    for row in rows:
        try:
            settings = json.loads(row["settings_json"] or "{}")
        except json.JSONDecodeError:
            settings = {}
        modes[int(row["product_id"])].add(str((settings or {}).get("mode") or ""))
    return all(modes[pid] == {"fixture"} for pid in ids)


def upsert_tcg_match(
    *,
    product_id: int,
    job_id: int,
    query: str,
    status: str,
    tcg_url: str | None,
    tcg_name: str | None,
    tcg_set: str | None,
    price: float | None,
    currency: str | None,
    confidence: float | None,
    raw: dict | None,
) -> None:
    now = utcnow()
    with _tx() as conn:
        conn.execute(
            """
            INSERT INTO tcgplayer_matches (
              product_id, job_id, query, status, tcg_url, tcg_name, tcg_set,
              price, currency, confidence, raw_json, matched_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(product_id) DO UPDATE SET
              job_id = excluded.job_id,
              query = excluded.query,
              status = excluded.status,
              tcg_url = excluded.tcg_url,
              tcg_name = excluded.tcg_name,
              tcg_set = excluded.tcg_set,
              price = excluded.price,
              currency = excluded.currency,
              confidence = excluded.confidence,
              raw_json = excluded.raw_json,
              matched_at = excluded.matched_at
            """,
            (
                product_id,
                job_id,
                query,
                status,
                tcg_url,
                tcg_name,
                tcg_set,
                price,
                currency,
                confidence,
                json.dumps(raw or {}),
                now,
            ),
        )


def clear_tcg_match(product_id: int) -> None:
    with _tx() as conn:
        row = conn.execute("SELECT id FROM products WHERE id = ?", (product_id,)).fetchone()
        if row is None:
            raise LookupError(product_id)
        conn.execute("DELETE FROM tcgplayer_matches WHERE product_id = ?", (product_id,))


def clear_tcg_matches_for_job(job_id: int) -> int:
    with _tx() as conn:
        cur = conn.execute(
            """
            DELETE FROM tcgplayer_matches
            WHERE product_id IN (
              SELECT product_id FROM scrape_observations WHERE job_id = ?
            )
            """,
            (job_id,),
        )
        return int(cur.rowcount)


def note_match_progress(job_id: int, checked: int, message: str) -> bool:
    now = utcnow()
    with _tx() as conn:
        cur = conn.execute(
            """
            UPDATE scrape_jobs
            SET pages_visited = ?, error_message = ?, updated_at = ?
            WHERE id = ? AND status = 'running'
            """,
            (checked, message, now, job_id),
        )
        return cur.rowcount > 0


def complete_match_job(job_id: int, *, checked: int, message: str) -> bool:
    now = utcnow()
    with _tx() as conn:
        cur = conn.execute(
            """
            UPDATE scrape_jobs
            SET status = 'completed',
                pages_visited = ?,
                items_scraped = ?,
                error_message = ?,
                finished_at = ?,
                updated_at = ?
            WHERE id = ? AND status = 'running'
            """,
            (checked, checked, message, now, now, job_id),
        )
        return cur.rowcount > 0


def block_match_job(job_id: int, *, checked: int, message: str) -> bool:
    now = utcnow()
    with _tx() as conn:
        row = _get(conn, job_id)
        if row is None or row["status"] not in {"running", "paused"}:
            return False
        settings = _settings(row)
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
                checked,
                checked,
                message,
                now,
                json.dumps(settings),
                now,
                job_id,
            ),
        )
        return True


def list_result_cards(job_id: int, limit: int) -> list[dict]:
    """Earliest search-result cards from this job that have a product URL."""
    with _tx() as conn:
        rows = conn.execute(
            """
            SELECT p.asin, p.title, p.product_url
            FROM scrape_observations o
            JOIN products p ON p.id = o.product_id
            WHERE o.job_id = ?
              AND COALESCE(o.source, 'results') = 'results'
              AND p.product_url IS NOT NULL
              AND p.product_url != ''
            ORDER BY o.page_number IS NULL, o.page_number ASC, o.id ASC
            LIMIT ?
            """,
            (job_id, limit),
        ).fetchall()
    return [dict(row) for row in rows]


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


def normalize_title(title: str) -> str:
    return " ".join(re.sub(r"[^a-z0-9]+", " ", (title or "").lower()).split())


def _null_asin_match(conn: sqlite3.Connection, title: str, url: str | None) -> int | None:
    """Best-effort: attach a new ASIN to one existing card that never had one.

    A shared product URL wins. Otherwise a single null-ASIN row with the same
    normalized title (at least 12 characters) is used. Several title matches
    are left alone.
    """
    if url:
        row = conn.execute(
            """
            SELECT id FROM products
            WHERE asin IS NULL AND product_url = ?
            ORDER BY last_seen_at DESC, id DESC
            LIMIT 1
            """,
            (url,),
        ).fetchone()
        if row is not None:
            return int(row["id"])
    norm = normalize_title(title)
    if len(norm) < 12:
        return None
    rows = conn.execute(
        "SELECT id, title FROM products WHERE asin IS NULL"
    ).fetchall()
    matches = [row for row in rows if normalize_title(row["title"]) == norm]
    if len(matches) == 1:
        return int(matches[0]["id"])
    return None


def _product_brief(row: sqlite3.Row, observation_count: int) -> dict:
    return {
        "id": row["id"],
        "asin": row["asin"],
        "title": row["title"],
        "image_url": row["image_url"],
        "product_url": row["product_url"],
        "category_breadcrumbs": row["category_breadcrumbs"],
        "first_seen_at": row["first_seen_at"],
        "last_seen_at": row["last_seen_at"],
        "observation_count": observation_count,
        "bought_past_month": row["bought_past_month"],
        "bought_past_month_text": row["bought_past_month_text"],
        "tcg_status": row["tcg_status"],
        "tcg_url": row["tcg_url"],
        "tcg_name": row["tcg_name"],
        "tcg_set": row["tcg_set"],
        "tcg_price": row["tcg_price"],
        "tcg_currency": row["tcg_currency"],
        "tcg_confidence": row["tcg_confidence"],
        "tcg_query": row["tcg_query"],
    }


def list_products(
    *,
    q: str | None = None,
    has_asin: str | None = None,
    last_seen_after: str | None = None,
    last_seen_before: str | None = None,
    limit: int = 25,
    offset: int = 0,
) -> dict:
    where = ["1 = 1"]
    args: list = []
    if q:
        like = f"%{_escape_like(q)}%"
        where.append(
            "(title LIKE ? ESCAPE '\\' OR IFNULL(asin, '') LIKE ? ESCAPE '\\' "
            "OR IFNULL(product_url, '') LIKE ? ESCAPE '\\')"
        )
        args.extend([like, like, like])
    if has_asin == "yes":
        where.append("asin IS NOT NULL")
    elif has_asin == "no":
        where.append("asin IS NULL")
    if last_seen_after:
        where.append("last_seen_at >= ?")
        args.append(last_seen_after)
    if last_seen_before:
        where.append("last_seen_at < ?")
        args.append(last_seen_before)
    clause = " AND ".join(where)
    with _tx() as conn:
        total = conn.execute(
            f"SELECT COUNT(*) AS n FROM products WHERE {clause}",
            args,
        ).fetchone()["n"]
        rows = conn.execute(
            f"""
            SELECT p.*,
                   (SELECT COUNT(*) FROM scrape_observations o WHERE o.product_id = p.id)
                     AS observation_count,
                   (
                     SELECT o.bought_past_month
                     FROM scrape_observations o
                     WHERE o.product_id = p.id
                     ORDER BY o.observed_at DESC, o.id DESC
                     LIMIT 1
                   ) AS bought_past_month,
                   (
                     SELECT o.bought_past_month_text
                     FROM scrape_observations o
                     WHERE o.product_id = p.id
                     ORDER BY o.observed_at DESC, o.id DESC
                     LIMIT 1
                   ) AS bought_past_month_text,
                   tcg.status AS tcg_status,
                   tcg.tcg_url AS tcg_url,
                   tcg.tcg_name AS tcg_name,
                   tcg.tcg_set AS tcg_set,
                   tcg.price AS tcg_price,
                   tcg.currency AS tcg_currency,
                   tcg.confidence AS tcg_confidence,
                   tcg.query AS tcg_query
            FROM products p
            LEFT JOIN tcgplayer_matches tcg ON tcg.product_id = p.id
            WHERE {clause}
            ORDER BY last_seen_at DESC, id DESC
            LIMIT ? OFFSET ?
            """,
            [*args, limit, offset],
        ).fetchall()
    items = [_product_brief(row, int(row["observation_count"])) for row in rows]
    return {"total": int(total), "items": items}


def _clean_asin(asin: str | None) -> str | None:
    cleaned = (asin or "").strip().upper()
    if not cleaned:
        return None
    if not re.fullmatch(r"[A-Z0-9]{10}", cleaned):
        raise ValueError("ASIN must be 10 letters or digits, or blank")
    return cleaned


def update_product(
    product_id: int,
    *,
    title: str,
    asin: str | None,
    image_url: str | None,
    product_url: str | None,
    category_breadcrumbs: str | None,
) -> dict:
    title = " ".join((title or "").split())
    if not title:
        raise ValueError("Title is required")
    asin = _clean_asin(asin)
    image_url = (image_url or "").strip() or None
    product_url = (product_url or "").strip() or None
    category_breadcrumbs = (category_breadcrumbs or "").strip() or None
    now = utcnow()
    with _tx() as conn:
        row = conn.execute("SELECT * FROM products WHERE id = ?", (product_id,)).fetchone()
        if row is None:
            raise LookupError(product_id)
        if asin:
            clash = conn.execute(
                "SELECT id FROM products WHERE asin = ? AND id != ?",
                (asin, product_id),
            ).fetchone()
            if clash is not None:
                raise CatalogError(f"ASIN {asin} is already on product {clash['id']}")
        conn.execute(
            """
            UPDATE products
            SET title = ?, asin = ?, image_url = ?, product_url = ?,
                category_breadcrumbs = ?, updated_at = ?
            WHERE id = ?
            """,
            (title, asin, image_url, product_url, category_breadcrumbs, now, product_id),
        )
    product = get_product(product_id)
    assert product is not None
    return product


def delete_product(product_id: int, *, force: bool = False) -> None:
    with _tx() as conn:
        row = conn.execute("SELECT id FROM products WHERE id = ?", (product_id,)).fetchone()
        if row is None:
            raise LookupError(product_id)
        count = conn.execute(
            "SELECT COUNT(*) AS n FROM scrape_observations WHERE product_id = ?",
            (product_id,),
        ).fetchone()["n"]
        if count and not force:
            raise CatalogError(
                f"This product has {int(count)} observation"
                f"{'' if int(count) == 1 else 's'}. Delete is blocked unless you force it."
            )
        jobs = [
            int(item["job_id"])
            for item in conn.execute(
                "SELECT DISTINCT job_id FROM scrape_observations WHERE product_id = ?",
                (product_id,),
            )
        ]
        conn.execute("DELETE FROM products WHERE id = ?", (product_id,))
        for job_id in jobs:
            _recount_job(conn, job_id)


def delete_observation(observation_id: int) -> int:
    with _tx() as conn:
        row = conn.execute(
            "SELECT job_id FROM scrape_observations WHERE id = ?",
            (observation_id,),
        ).fetchone()
        if row is None:
            raise LookupError(observation_id)
        job_id = int(row["job_id"])
        conn.execute("DELETE FROM scrape_observations WHERE id = ?", (observation_id,))
        _recount_job(conn, job_id)
        return job_id


def delete_job(job_id: int) -> None:
    with _tx() as conn:
        row = _get(conn, job_id)
        if row is None:
            raise LookupError(job_id)
        if row["status"] in {"queued", "running", "paused"}:
            raise JobStateError("Stop this job, or let it finish, before deleting it")
        conn.execute(
            "UPDATE scrape_jobs SET parent_job_id = NULL WHERE parent_job_id = ?",
            (job_id,),
        )
        conn.execute("DELETE FROM scrape_jobs WHERE id = ?", (job_id,))


def merge_products(keep_id: int, drop_id: int) -> dict:
    if keep_id == drop_id:
        raise CatalogError("Pick two different products")
    now = utcnow()
    with _tx() as conn:
        keep = conn.execute("SELECT * FROM products WHERE id = ?", (keep_id,)).fetchone()
        drop = conn.execute("SELECT * FROM products WHERE id = ?", (drop_id,)).fetchone()
        if keep is None or drop is None:
            raise LookupError(keep_id if keep is None else drop_id)
        if keep["asin"] and drop["asin"] and keep["asin"] != drop["asin"]:
            raise CatalogError(
                "Both products have different ASINs. Clear one ASIN, then merge."
            )
        moved_asin = None
        if not keep["asin"] and drop["asin"]:
            moved_asin = drop["asin"]
            conn.execute("UPDATE products SET asin = NULL WHERE id = ?", (drop_id,))
        affected: set[int] = set()
        drop_rows = conn.execute(
            "SELECT * FROM scrape_observations WHERE product_id = ?",
            (drop_id,),
        ).fetchall()
        for obs in drop_rows:
            job_id = int(obs["job_id"])
            affected.add(job_id)
            conflict = conn.execute(
                """
                SELECT id, observed_at FROM scrape_observations
                WHERE job_id = ? AND product_id = ?
                """,
                (job_id, keep_id),
            ).fetchone()
            if conflict is None:
                conn.execute(
                    "UPDATE scrape_observations SET product_id = ? WHERE id = ?",
                    (keep_id, obs["id"]),
                )
                continue
            drop_later = (obs["observed_at"] or "") > (conflict["observed_at"] or "")
            if drop_later:
                conn.execute(
                    "DELETE FROM scrape_observations WHERE id = ?",
                    (conflict["id"],),
                )
                conn.execute(
                    "UPDATE scrape_observations SET product_id = ? WHERE id = ?",
                    (keep_id, obs["id"]),
                )
            else:
                conn.execute("DELETE FROM scrape_observations WHERE id = ?", (obs["id"],))
        conn.execute(
            """
            UPDATE products
            SET asin = COALESCE(?, asin),
                image_url = COALESCE(image_url, ?),
                product_url = COALESCE(product_url, ?),
                category_breadcrumbs = COALESCE(category_breadcrumbs, ?),
                last_seen_at = CASE WHEN last_seen_at >= ? THEN last_seen_at ELSE ? END,
                updated_at = ?
            WHERE id = ?
            """,
            (
                moved_asin,
                drop["image_url"],
                drop["product_url"],
                drop["category_breadcrumbs"],
                drop["last_seen_at"],
                drop["last_seen_at"],
                now,
                keep_id,
            ),
        )
        keep_match = conn.execute(
            "SELECT 1 FROM tcgplayer_matches WHERE product_id = ?",
            (keep_id,),
        ).fetchone()
        if keep_match is None:
            conn.execute(
                "UPDATE tcgplayer_matches SET product_id = ? WHERE product_id = ?",
                (keep_id, drop_id),
            )
        conn.execute("DELETE FROM products WHERE id = ?", (drop_id,))
        for job_id in affected:
            _recount_job(conn, job_id)
    product = get_product(keep_id)
    assert product is not None
    return product


def duplicate_hints(limit: int = 40) -> list[dict]:
    with _tx() as conn:
        rows = conn.execute(
            """
            SELECT p.id, p.asin, p.title, p.product_url, p.last_seen_at,
                   (SELECT COUNT(*) FROM scrape_observations o WHERE o.product_id = p.id)
                     AS observation_count
            FROM products p
            ORDER BY p.id ASC
            """
        ).fetchall()
    products = [dict(row) for row in rows]
    by_title: dict[str, list[dict]] = {}
    for product in products:
        norm = normalize_title(product["title"])
        if len(norm) < 12:
            continue
        by_title.setdefault(norm, []).append(product)
    hints: list[dict] = []
    seen: set[tuple[int, int]] = set()

    def add(reason: str, members: list[dict]) -> None:
        if len(hints) >= limit or len(members) < 2:
            return
        keep = _prefer_keep(members)
        for other in members:
            if other["id"] == keep["id"]:
                continue
            pair = (int(keep["id"]), int(other["id"]))
            if pair in seen:
                continue
            seen.add(pair)
            hints.append(
                {
                    "id": f"{pair[0]}-{pair[1]}",
                    "reason": reason,
                    "keep_id": pair[0],
                    "drop_id": pair[1],
                    "keep_title": keep["title"],
                    "drop_title": other["title"],
                    "keep_asin": keep["asin"],
                    "drop_asin": other["asin"],
                }
            )
            if len(hints) >= limit:
                return

    for members in by_title.values():
        if len(members) >= 2:
            add("Same normalized title", members)
    asin_rows = [product for product in products if product["asin"]]
    null_rows = [product for product in products if not product["asin"]]
    for blank in null_rows:
        norm = normalize_title(blank["title"])
        for owned in asin_rows:
            url_match = (
                blank["product_url"]
                and owned["product_url"]
                and blank["product_url"] == owned["product_url"]
            )
            title_match = len(norm) >= 12 and norm == normalize_title(owned["title"])
            if url_match or title_match:
                reason = (
                    "No ASIN, but the product URL matches an ASIN row"
                    if url_match
                    else "No ASIN, but the title matches an ASIN row"
                )
                add(reason, [owned, blank])
    return hints


def _prefer_keep(members: list[dict]) -> dict:
    with_asin = [item for item in members if item["asin"]]
    if len(with_asin) == 1:
        return with_asin[0]
    return max(members, key=lambda item: (int(item["observation_count"]), -int(item["id"])))


def recount_items(job_id: int) -> None:
    """Refresh items_scraped so a later recheck can tell new pages from related cards."""
    with _tx() as conn:
        if _get(conn, job_id) is None:
            return
        _recount_job(conn, job_id)


def _recount_job(conn: sqlite3.Connection, job_id: int) -> None:
    conn.execute(
        """
        UPDATE scrape_jobs
        SET items_scraped = ?, updated_at = ?
        WHERE id = ?
        """,
        (_count_obs(conn, job_id), utcnow(), job_id),
    )
