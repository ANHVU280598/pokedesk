"""Background worker. One job at a time, pause/stop checked between pages."""

from __future__ import annotations

import asyncio
import logging
import time

from app import db
from app.scraper.parser import card_payload, parse_related_cards, parse_results
from app.scraper.sessions import FixtureSession, PlaywrightSession
from app.service import (
    playwright_proxy,
    recheck_patch,
    recheck_result_message,
    retry_wait_seconds,
)

logger = logging.getLogger(__name__)

PAGE_CAP_MESSAGE = (
    "Amazon appears to have capped pagination before the result set ended. "
    "Results already stored were kept."
)
REPEAT_MESSAGE = (
    "Amazon repeated a results page instead of advancing. "
    "Results already stored were kept."
)
HTTP_BLOCK = "Amazon returned HTTP {status}. Results already stored were kept."


class JobRunner:
    def __init__(self) -> None:
        self._task: asyncio.Task | None = None
        self._stop = asyncio.Event()
        self._wake = asyncio.Event()
        self._active_job_id: int | None = None

    async def start(self) -> None:
        self._task = asyncio.create_task(self._loop(), name="scrape-worker")

    async def stop(self) -> None:
        self._stop.set()
        self._wake.set()
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None

    def notify(self) -> None:
        self._wake.set()

    def is_active(self, job_id: int) -> bool:
        return self._active_job_id == job_id

    async def _loop(self) -> None:
        while not self._stop.is_set():
            job_id = db.claim_next_queued()
            if job_id is None:
                try:
                    await asyncio.wait_for(self._wake.wait(), timeout=1.0)
                except asyncio.TimeoutError:
                    pass
                self._wake.clear()
                continue
            self._active_job_id = job_id
            try:
                await run_job(job_id)
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("job %s crashed", job_id)
                db.finish_if_running(job_id, "failed", "Unexpected worker error")
                _settle_parent_recheck(job_id)
            finally:
                self._active_job_id = None


async def run_job(job_id: int) -> None:
    job = db.get_job(job_id)
    if job is None or job["status"] != "running":
        return
    settings = job["settings"]
    session = None
    try:
        session = await _open_session(settings)
        url = settings.get("resume_url") or job["start_url"]
        if not url:
            db.finish_if_running(job_id, "failed", "Job has no start URL")
            return
        wait = settings.get("retry_wait_sec")
        if wait:
            status = await sleep_while_running(job_id, float(wait))
            db.merge_settings(job_id, {"retry_wait_sec": None})
            if status != "running":
                return
            db.set_error_message_if_running(job_id, None)

        pending_html: str | None = None
        last_signature: tuple | None = None
        visited_urls: set[str] = set()
        allow_repeat = False

        async def recover(pages_visited: int, resume_url: str | None, next_page_number: int, message: str) -> bool:
            nonlocal url, pending_html, allow_repeat
            nxt = await _stop_or_continue(
                session,
                job_id,
                pages_visited=pages_visited,
                resume_url=resume_url,
                next_page_number=next_page_number,
                message=message,
            )
            if not nxt:
                return False
            url = nxt
            pending_html = None
            allow_repeat = True
            return True

        while True:
            status = await wait_until_not_paused(job_id)
            if status != "running":
                return
            job = db.get_job(job_id)
            if job is None:
                return
            settings = job["settings"]
            page_num = int(settings.get("next_page_number") or 1)
            max_pages = int(settings.get("max_pages") or 1)
            delay_s = int(settings.get("delay_ms") or 0) / 1000

            if pending_html is None:
                if url in visited_urls and not allow_repeat:
                    if not await recover(
                        int(job["pages_visited"] or 0),
                        url,
                        page_num,
                        REPEAT_MESSAGE,
                    ):
                        return
                    continue
                allow_repeat = False
                html = await session.get(url)
                page_url = session.current_url() or url
                visited_urls.add(url)
                visited_urls.add(page_url)
            else:
                html = pending_html
                pending_html = None
                page_url = session.current_url() or url

            parsed = parse_results(html, page_url)
            if (
                parsed.block_reason is None
                and not parsed.cards
                and session.last_status in {403, 429, 503}
            ):
                parsed.block_reason = HTTP_BLOCK.format(status=session.last_status)

            if parsed.block_reason:
                db.add_snapshot(job_id, page_num, page_url, 0)
                reported_pages = page_num
                if settings.get("recheck_mode"):
                    reported_pages = int(job["pages_visited"] or 0)
                if not await recover(
                    reported_pages,
                    page_url,
                    reported_pages or page_num,
                    parsed.block_reason,
                ):
                    return
                continue

            signature = tuple(
                card.asin or card.product_url or card.title for card in parsed.cards
            )
            if (
                signature
                and signature == last_signature
                and parsed.pagination_mode == "show_more"
            ):
                if parsed.suggests_more and page_num < max_pages:
                    if not await recover(page_num, page_url, page_num, PAGE_CAP_MESSAGE):
                        return
                    continue
                _complete(job_id, None)
                return
            last_signature = signature

            for card in parsed.cards:
                db.upsert_card(
                    job_id,
                    card_payload(card, page_url, parsed.breadcrumbs, page_num),
                )
            db.add_snapshot(job_id, page_num, page_url, len(parsed.cards))
            db.record_page(
                job_id,
                page_num=page_num,
                detected_mode=parsed.pagination_mode,
                next_page_number=page_num + 1,
                resume_url=parsed.next_url or page_url,
            )
            logger.info(
                "job %s page %s mode %s cards %s",
                job_id,
                page_num,
                parsed.pagination_mode,
                len(parsed.cards),
            )

            status = await wait_until_not_paused(job_id)
            if status != "running":
                return
            if page_num >= max_pages:
                _complete(job_id, None)
                return

            if parsed.pagination_mode == "next_page" and parsed.next_url:
                url = parsed.next_url
                if await sleep_while_running(job_id, delay_s) != "running":
                    return
                continue

            if parsed.pagination_mode == "show_more":
                if await sleep_while_running(job_id, delay_s) != "running":
                    return
                if await wait_until_not_paused(job_id) != "running":
                    return
                if parsed.next_url:
                    url = parsed.next_url
                    continue
                more = await session.show_more()
                if not more:
                    if parsed.suggests_more:
                        if not await recover(page_num, page_url, page_num, PAGE_CAP_MESSAGE):
                            return
                        continue
                    _complete(job_id, None)
                    return
                pending_html = more
                continue

            if parsed.suggests_more and page_num < max_pages:
                if not await recover(page_num, page_url, page_num, PAGE_CAP_MESSAGE):
                    return
                continue
            else:
                message = None
                if page_num == 1 and not parsed.cards:
                    message = "No product cards found on the first page."
                _complete(job_id, message)
            return
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        logger.exception("job %s failed", job_id)
        db.finish_if_running(job_id, "failed", _short_error(exc))
    finally:
        if session is not None:
            await session.close()
        _settle_parent_recheck(job_id)


async def _stop_or_continue(
    session,
    job_id: int,
    *,
    pages_visited: int,
    resume_url: str | None,
    next_page_number: int,
    message: str,
) -> str | None:
    """Run the blocked-recovery pattern once, or finalize the soft block.

    Returns the results URL to open next, or None when the job should stop.
    """
    status = db.get_status(job_id)
    if status not in {"running", "paused"}:
        return None
    job = db.get_job(job_id)
    if job is None:
        return None
    settings = job.get("settings") or {}
    if settings.get("recheck_mode") or settings.get("pattern_handled"):
        _block(
            job_id,
            pages_visited=pages_visited,
            resume_url=resume_url,
            next_page_number=next_page_number,
            message=message,
        )
        return None
    expand = bool(settings.get("expand_related"))
    recheck = bool(settings.get("recheck_after_block"))
    if not expand and not recheck:
        _block(
            job_id,
            pages_visited=pages_visited,
            resume_url=resume_url,
            next_page_number=next_page_number,
            message=message,
        )
        return None
    db.merge_settings(
        job_id,
        {
            "pattern_handled": True,
            "blocked_resume_url": resume_url,
            "blocked_page": pages_visited,
            "blocked_message": message,
        },
    )
    if expand and int(settings.get("related_cards_limit") or 0) > 0:
        phase = await _expand_related(session, job_id)
        if phase != "running":
            return None
    if db.get_status(job_id) == "running":
        db.recount_items(job_id)
    job = db.get_job(job_id) or job
    settings = job.get("settings") or settings
    if recheck and db.get_status(job_id) == "running":
        snapshot = {
            "start_url": job.get("start_url"),
            "pages_visited": pages_visited,
            "items_scraped": job.get("items_scraped") or 0,
            "settings": {**settings, "resume_url": resume_url or job.get("start_url")},
        }
        patch = recheck_patch(snapshot, "continue")
        db.merge_settings(
            job_id,
            {**patch, "pattern_phase": "recheck", "pattern_handled": True},
        )
        db.set_error_message_if_running(job_id, "Rechecking blocked list…")
        return str(patch.get("resume_url") or "") or None
    _block(
        job_id,
        pages_visited=pages_visited,
        resume_url=resume_url,
        next_page_number=next_page_number,
        message=message,
    )
    return None


async def _expand_related(session, job_id: int) -> str:
    """Open up to N early result cards and store related items found on them."""
    job = db.get_job(job_id)
    if job is None:
        return "failed"
    settings = job.get("settings") or {}
    limit = max(0, int(settings.get("related_cards_limit") or 0))
    seeds = db.list_result_cards(job_id, limit)
    delay_s = int(settings.get("delay_ms") or 0) / 1000
    db.merge_settings(
        job_id,
        {
            "pattern_phase": "related",
            "related_index": 0,
            "related_total": len(seeds),
            "related_visited": 0,
        },
    )
    visited = 0
    for index, seed in enumerate(seeds, start=1):
        status = await wait_until_not_paused(job_id)
        if status != "running":
            db.merge_settings(job_id, {"pattern_phase": None})
            return status
        db.merge_settings(job_id, {"related_index": index, "related_total": len(seeds)})
        db.set_error_message_if_running(
            job_id,
            f"Related items: card {index}/{len(seeds)}…",
        )
        if await sleep_while_running(job_id, delay_s) != "running":
            db.merge_settings(job_id, {"pattern_phase": None})
            return db.get_status(job_id) or "failed"
        product_url = seed.get("product_url") or ""
        try:
            html = await session.get(product_url)
            page_url = session.current_url() or product_url
        except Exception:
            logger.info("job %s skipped related card %s", job_id, product_url)
            continue
        if db.get_status(job_id) != "running":
            db.merge_settings(job_id, {"pattern_phase": None})
            return db.get_status(job_id) or "failed"
        for card in parse_related_cards(html, page_url, skip_asin=seed.get("asin")):
            payload = card_payload(card, page_url, None, 0)
            payload["source"] = "related"
            payload["page_number"] = None
            try:
                db.upsert_card(job_id, payload)
            except ValueError:
                continue
        visited += 1
        db.merge_settings(job_id, {"related_visited": visited})
    db.merge_settings(job_id, {"pattern_phase": None})
    return db.get_status(job_id) or "failed"


def _complete(job_id: int, message: str | None) -> None:
    job = db.get_job(job_id)
    outcome = None
    if job and (job.get("settings") or {}).get("recheck_mode"):
        pages = int(job.get("pages_visited") or 0)
        message, outcome = recheck_result_message(
            advanced=_recheck_advanced(job, pages),
            blocked=False,
            pages=pages,
            base=message,
        )
    db.finish_if_running(job_id, "completed", message)
    if outcome:
        db.merge_settings(
            job_id,
            {
                "recheck_mode": None,
                "recheck_outcome": outcome,
                "recheck_pending": False,
                "pattern_phase": None,
            },
        )
    elif job and (job.get("settings") or {}).get("pattern_phase"):
        db.merge_settings(job_id, {"pattern_phase": None})


def _block(
    job_id: int,
    *,
    pages_visited: int,
    resume_url: str | None,
    next_page_number: int,
    message: str,
) -> None:
    status = db.get_status(job_id)
    if status not in {"running", "paused"}:
        return
    job = db.get_job(job_id)
    outcome = None
    if job and (job.get("settings") or {}).get("recheck_mode"):
        message, outcome = recheck_result_message(
            advanced=_recheck_advanced(job, pages_visited),
            blocked=True,
            pages=pages_visited,
            base=message,
        )
    db.mark_blocked(
        job_id,
        pages_visited=pages_visited,
        resume_url=resume_url,
        next_page_number=next_page_number,
        message=message,
    )
    if outcome:
        db.merge_settings(
            job_id,
            {
                "recheck_mode": None,
                "recheck_outcome": outcome,
                "recheck_pending": False,
                "pattern_phase": None,
            },
        )
    elif job and (job.get("settings") or {}).get("pattern_phase"):
        db.merge_settings(job_id, {"pattern_phase": None})


def _recheck_advanced(job: dict, pages_visited: int) -> bool:
    settings = job.get("settings") or {}
    before_pages = int(settings.get("recheck_pages_before") or 0)
    before_items = int(settings.get("recheck_items_before") or 0)
    items = int(job.get("items_scraped") or 0)
    return pages_visited > before_pages or items > before_items


def _settle_parent_recheck(job_id: int) -> None:
    """After follow-ups finish, reload the blocked parent once."""
    job = db.get_job(job_id)
    if job is None or not job.get("parent_job_id"):
        return
    if job["status"] in {"queued", "running", "paused"}:
        return
    parent = db.get_job(int(job["parent_job_id"]))
    if parent is None or parent["status"] != "blocked":
        return
    if not (parent.get("settings") or {}).get("recheck_pending"):
        return
    if db.open_child_count(parent["id"]):
        return
    try:
        db.queue_recheck(
            parent["id"],
            recheck_patch(parent, "continue"),
            retry_wait_seconds(parent.get("settings") or {}),
        )
    except (LookupError, db.JobStateError):
        return


async def _open_session(settings: dict):
    resume = str(settings.get("resume_url") or "")
    if settings.get("mode") == "fixture" or resume.startswith("fixture:"):
        return FixtureSession(settings.get("fixture_set") or "pokemon")
    return await PlaywrightSession.launch(
        headless=bool(settings.get("headless", True)),
        proxy=playwright_proxy(settings),
    )


async def wait_until_not_paused(job_id: int) -> str:
    while True:
        status = db.get_status(job_id)
        if status != "paused":
            return status or "failed"
        await asyncio.sleep(0.15)


async def sleep_while_running(job_id: int, seconds: float) -> str:
    deadline = time.monotonic() + max(0.0, seconds)
    while True:
        status = db.get_status(job_id)
        if status is None:
            return "failed"
        if status == "paused":
            await asyncio.sleep(0.15)
            continue
        if status != "running":
            return status
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            return "running"
        await asyncio.sleep(min(0.15, remaining))


def _short_error(exc: Exception) -> str:
    text = " ".join((str(exc).strip() or exc.__class__.__name__).split())
    if len(text) > 400:
        return text[:397] + "..."
    return text
