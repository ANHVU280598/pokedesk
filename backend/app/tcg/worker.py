"""Match Amazon products against TCGPlayer, one search at a time.

Pause and stop are checked between products. The delay is the job's delay,
the same setting Amazon page turns use. This does not click around or
open a second browser.
"""

from __future__ import annotations

from app import db
from app.tcg.search import TCG_READY, choose_match, page_is_blocked, parse_results, search_query, search_url

BLOCK_MESSAGE = (
    "TCGPlayer soft-blocked this session. Matches already stored were kept."
)


async def run_tcg_match(job_id: int, settings: dict, session) -> None:
    from app.scraper.runner import sleep_while_running, wait_until_not_paused

    product_ids = [int(value) for value in (settings.get("product_ids") or [])]
    products = db.list_products_by_ids(product_ids)
    delay = float(settings.get("delay_ms") or 0) / 1000.0
    matched = 0
    confirm = 0
    unmatched = 0
    total = len(products)
    if total == 0:
        db.complete_match_job(job_id, checked=0, message="No products to match.")
        return

    for index, product in enumerate(products, start=1):
        status = await wait_until_not_paused(job_id)
        if status != "running":
            return
        if delay > 0:
            status = await sleep_while_running(job_id, delay)
            if status != "running":
                return
        query = search_query(product["title"])
        message = f"TCGPlayer: {index}/{total} {query}"
        if not db.note_match_progress(job_id, index - 1, message):
            return
        try:
            html = await _fetch(session, query)
        except Exception as exc:
            db.finish_if_running(job_id, "failed", _short(exc))
            return
        status_code = getattr(session, "last_status", None)
        if page_is_blocked(html, status_code):
            db.block_match_job(job_id, checked=index - 1, message=BLOCK_MESSAGE)
            return
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
        )
        if not db.note_match_progress(job_id, index, message):
            return

    summary = f"Matched {matched}, confirm {confirm}, unmatched {unmatched}."
    db.complete_match_job(job_id, checked=total, message=summary)


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
