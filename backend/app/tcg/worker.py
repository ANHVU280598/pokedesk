"""Match Amazon products against TCGPlayer, one search at a time.

Pause and stop are checked between products. A failure on one product is
stored on that row and the batch continues. A soft-block stops further
requests so the session is not hammered; rows already stored are kept.
"""

from __future__ import annotations

import logging

from app import db
from app.tcg.search import TCG_READY, choose_match, page_is_blocked, parse_results, search_query, search_url

log = logging.getLogger("app.tcg")

BLOCK_MESSAGE = "TCGPlayer soft-blocked this request. Matches already stored were kept."


async def run_tcg_match(job_id: int, settings: dict, session) -> None:
    from app.scraper.runner import sleep_while_running, wait_until_not_paused

    product_ids = [int(value) for value in (settings.get("product_ids") or [])]
    products = db.list_products_by_ids(product_ids)
    delay = float(settings.get("delay_ms") or 0) / 1000.0
    matched = 0
    confirm = 0
    unmatched = 0
    errors = 0
    total = len(products)
    skipped = int(settings.get("skipped_matched") or 0)
    if total == 0:
        db.complete_match_job(job_id, checked=0, message=_summary(0, 0, 0, 0, skipped))
        return

    blocked = False
    for index, product in enumerate(products, start=1):
        status = await wait_until_not_paused(job_id)
        if status != "running":
            return
        if delay > 0 and index > 1:
            status = await sleep_while_running(job_id, delay)
            if status != "running":
                return
        query = search_query(product["title"])
        message = f"Matching {index} / {total}"
        if not db.note_match_progress(job_id, index - 1, f"{message}: {query}"):
            return
        try:
            html = await _fetch(session, query)
        except Exception as exc:
            errors += 1
            detail = _short(exc)
            _log_row(product, detail)
            _store_error(job_id, product, query, detail)
            if not db.note_match_progress(job_id, index, f"{message}: {detail}"):
                return
            continue
        status_code = getattr(session, "last_status", None)
        if page_is_blocked(html, status_code):
            errors += 1
            blocked = True
            _log_row(product, BLOCK_MESSAGE)
            _store_error(job_id, product, query, BLOCK_MESSAGE)
            db.note_match_progress(job_id, index, f"{message}: {BLOCK_MESSAGE}")
            break
        decision = choose_match(query, parse_results(html))
        if decision["status"] == "matched":
            matched += 1
        elif decision["status"] == "needs_confirm":
            confirm += 1
        else:
            unmatched += 1
        db.upsert_tcg_match(
            product_id=int(product["id"]),
            job_id=job_id,
            query=decision["query"],
            status=decision["status"],
            tcg_url=decision["tcg_url"],
            tcg_name=decision["tcg_name"],
            tcg_set=decision["tcg_set"],
            image_url=decision["image_url"],
            price=decision["price"],
            price_label=decision["price_label"],
            currency=decision["currency"],
            confidence=decision["confidence"],
            raw=decision["raw"],
            candidates=decision["candidates"],
            match_source="auto" if decision["status"] == "matched" else None,
            error_text=None,
        )
        if not db.note_match_progress(job_id, index, message):
            return

    summary = _summary(matched, confirm, unmatched, errors, skipped)
    if blocked:
        summary = f"{summary} Stopped after a TCGPlayer block so the rest of the list was not requested."
    print(f"TCGPlayer match job={job_id} {summary}", flush=True)
    log.info("TCGPlayer match job=%s %s", job_id, summary)
    db.complete_match_job(job_id, checked=matched + confirm + unmatched + errors, message=summary)


def _summary(matched: int, confirm: int, unmatched: int, errors: int, skipped: int) -> str:
    text = (
        f"Matched {matched}, needs your pick {confirm}, no match {unmatched}, errors {errors}."
    )
    if skipped:
        text += f" Skipped {skipped} already matched."
    return text


def _store_error(job_id: int, product: dict, query: str, detail: str) -> None:
    db.upsert_tcg_match(
        product_id=int(product["id"]),
        job_id=job_id,
        query=query or product.get("title") or "",
        status="error",
        tcg_url=None,
        tcg_name=None,
        tcg_set=None,
        image_url=None,
        price=None,
        price_label=None,
        currency=None,
        confidence=0,
        raw={"error": detail},
        candidates=[],
        match_source=None,
        error_text=detail,
    )


def _log_row(product: dict, detail: str) -> None:
    line = f"TCGPlayer match product={product.get('id')} title={product.get('title')!r} error={detail}"
    print(line, flush=True)
    log.error(line)


async def _fetch(session, query: str) -> str:
    search = getattr(session, "search", None)
    if search is not None:
        return await search(query)
    return await session.get(search_url(query), ready=TCG_READY)


def _short(exc: Exception) -> str:
    text = " ".join((str(exc).strip() or exc.__class__.__name__).split())
    if len(text) > 400:
        return text[:397] + "..."
    return text
