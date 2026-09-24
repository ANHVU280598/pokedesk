"""Operator HTTP API."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response

from app import db, exports, followups, settings_store
from app.schemas import (
    FollowUpCreate,
    JobCreate,
    ProductMerge,
    ProductTcgMatch,
    ProductUpdate,
    TcgConfirm,
    RecheckBody,
    SettingsUpdate,
    TcgMatchBody,
)
from app.service import (
    clean_settings,
    compose_new_job,
    compose_tcg_match_job,
    recheck_patch,
    retry_wait_seconds,
)

router = APIRouter(prefix="/api")

SORTS = {"page", "recent", "price_asc", "price_desc", "rating", "bought"}


@router.get("/health")
async def health() -> dict:
    return {"ok": True}


@router.get("/settings")
async def read_settings() -> dict:
    return settings_store.public()


@router.put("/settings")
async def write_settings(body: SettingsUpdate) -> dict:
    try:
        stored = settings_store.put(clean_settings(body, settings_store.get()))
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return settings_store.public(stored)


@router.post("/jobs", status_code=201)
async def create_job(body: JobCreate, request: Request) -> dict:
    try:
        spec = compose_new_job(body, settings_store.get())
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    job = db.create_job(**spec)
    request.app.state.runner.notify()
    return _public_job(job)


@router.get("/jobs")
async def list_jobs() -> list[dict]:
    return [_public_job(job) for job in db.list_jobs()]


@router.get("/jobs/{job_id}")
async def read_job(job_id: int) -> dict:
    job = db.get_job(job_id)
    if job is None:
        raise HTTPException(404, "Job not found")
    return _public_job(job)


@router.post("/jobs/{job_id}/pause")
async def pause_job(job_id: int) -> dict:
    return _run(lambda: db.pause_job(job_id))


@router.post("/jobs/{job_id}/resume")
async def resume_job(job_id: int, request: Request) -> dict:
    job = db.get_job(job_id)
    if job is None:
        raise HTTPException(404, "Job not found")
    if job["status"] != "paused":
        raise HTTPException(409, "Only a paused job can be resumed")
    requeue = not request.app.state.runner.is_active(job_id)
    resumed = _run(lambda: db.resume_job(job_id, requeue=requeue))
    if requeue:
        request.app.state.runner.notify()
    return resumed


@router.post("/jobs/{job_id}/stop")
async def stop_job(job_id: int) -> dict:
    return _run(lambda: db.stop_job(job_id))


@router.post("/jobs/{job_id}/retry")
async def retry_job(job_id: int, request: Request) -> dict:
    job = db.get_job(job_id)
    if job is None:
        raise HTTPException(404, "Job not found")
    if job["status"] != "blocked":
        raise HTTPException(409, "Only a blocked job can be retried")
    wait = retry_wait_seconds(job["settings"])
    queued = _run(lambda: db.queue_retry(job_id, wait))
    request.app.state.runner.notify()
    return _public_job(queued)


@router.post("/jobs/{job_id}/recheck")
async def recheck_job(job_id: int, request: Request, body: RecheckBody | None = None) -> dict:
    job = db.get_job(job_id)
    if job is None:
        raise HTTPException(404, "Job not found")
    if job["status"] != "blocked":
        raise HTTPException(409, "Only a blocked job can be rechecked")
    mode = body.mode if body is not None else "continue"
    try:
        patch = recheck_patch(job, mode)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    queued = _run(lambda: db.queue_recheck(job_id, patch, retry_wait_seconds(job["settings"])))
    request.app.state.runner.notify()
    return _public_job(queued)


@router.get("/jobs/{job_id}/observations")
async def list_observations(
    job_id: int,
    q: str | None = None,
    min_price: float | None = None,
    max_price: float | None = None,
    min_rating: float | None = None,
    min_bought: int | None = None,
    sort: str = "page",
    limit: int = 500,
) -> dict:
    if db.get_job(job_id) is None:
        raise HTTPException(404, "Job not found")
    if sort not in SORTS:
        raise HTTPException(400, "Unknown sort")
    bounded = max(1, min(limit, 1000))
    return db.list_observations(
        job_id,
        q=q.strip() if q else None,
        min_price=min_price,
        max_price=max_price,
        min_rating=min_rating,
        min_bought=min_bought,
        sort=sort,
        limit=bounded,
    )


@router.get("/jobs/{job_id}/follow-ups")
async def read_followups(job_id: int) -> dict:
    job = db.get_job(job_id)
    if job is None:
        raise HTTPException(404, "Job not found")
    try:
        suggestions = followups.suggest(job)
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc
    return {"job_id": job_id, "suggestions": suggestions}


@router.post("/jobs/{job_id}/follow-ups", status_code=201)
async def create_followups(job_id: int, body: FollowUpCreate, request: Request) -> dict:
    job = db.get_job(job_id)
    if job is None:
        raise HTTPException(404, "Job not found")
    try:
        specs = followups.materialize(job, body.suggestion_ids, settings_store.get())
    except ValueError as exc:
        status = 409 if "blocked" in str(exc) else 400
        raise HTTPException(status, str(exc)) from exc
    created = [db.create_job(**spec) for spec in specs]
    db.mark_recheck_pending(job_id)
    parent = db.get_job(job_id)
    request.app.state.runner.notify()
    return {
        "jobs": [_public_job(item) for item in created],
        "parent": None if parent is None else _public_job(parent),
    }


@router.post("/jobs/{job_id}/tcg-match", status_code=201)
async def start_job_tcg_match(
    job_id: int,
    request: Request,
    body: TcgMatchBody | None = None,
) -> dict:
    job = db.get_job(job_id)
    if job is None:
        raise HTTPException(404, "Job not found")
    if (job.get("settings") or {}).get("mode") == "tcgplayer":
        raise HTTPException(400, "Match an Amazon scrape, not a TCGPlayer pass")
    rows = db.list_match_products(job_id)
    wanted = None if body is None or body.product_ids is None else list(body.product_ids)
    if wanted is not None:
        if not wanted:
            raise HTTPException(400, "Pick at least one product")
        known = {int(row["id"]) for row in rows}
        if any(int(pid) not in known for pid in wanted):
            raise HTTPException(400, "Those products are not in this job")
        order = {int(pid): index for index, pid in enumerate(wanted)}
        rows = [row for row in rows if int(row["id"]) in order]
        rows.sort(key=lambda row: order[int(row["id"])])
    fixture = (job.get("settings") or {}).get("mode") == "fixture"
    try:
        spec = compose_tcg_match_job(
            products=rows,
            defaults=settings_store.get(),
            fixture=fixture,
            source_job_id=job_id,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    created = db.create_job(**spec)
    request.app.state.runner.notify()
    return _public_job(created)


@router.delete("/jobs/{job_id}/tcg-match")
async def clear_job_tcg_matches(job_id: int) -> dict:
    if db.get_job(job_id) is None:
        raise HTTPException(404, "Job not found")
    cleared = db.clear_tcg_matches_for_job(job_id)
    return {"ok": True, "cleared": cleared}


@router.delete("/jobs/{job_id}")
async def remove_job(job_id: int) -> dict:
    _catalog(lambda: db.delete_job(job_id))
    return {"ok": True}


@router.get("/products")
async def list_products(
    q: str | None = None,
    has_asin: str | None = None,
    last_seen_after: str | None = None,
    last_seen_before: str | None = None,
    limit: int = 25,
    offset: int = 0,
) -> dict:
    if has_asin not in {None, "", "yes", "no", "any"}:
        raise HTTPException(400, "has_asin must be yes, no, or any")
    try:
        after, before = _seen_bounds(last_seen_after, last_seen_before)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return db.list_products(
        q=q.strip() if q else None,
        has_asin=None if has_asin in {None, "", "any"} else has_asin,
        last_seen_after=after,
        last_seen_before=before,
        limit=max(1, min(limit, 100)),
        offset=max(0, offset),
    )


@router.get("/products/duplicates")
async def list_duplicates() -> dict:
    return {"hints": db.duplicate_hints()}


@router.post("/products/merge")
async def merge_products(body: ProductMerge) -> dict:
    return _catalog(lambda: db.merge_products(body.keep_id, body.drop_id))


@router.post("/products/tcg-match", status_code=201)
async def start_product_tcg_match(body: ProductTcgMatch, request: Request) -> dict:
    rows = db.list_products_by_ids(body.product_ids)
    if len(rows) != len(set(body.product_ids)):
        raise HTTPException(400, "Unknown product")
    try:
        spec = compose_tcg_match_job(
            products=rows,
            defaults=settings_store.get(),
            fixture=db.products_are_fixture_only(body.product_ids),
            source_job_id=None,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    created = db.create_job(**spec)
    request.app.state.runner.notify()
    return _public_job(created)


@router.get("/products/{product_id}")
async def read_product(product_id: int) -> dict:
    product = db.get_product(product_id)
    if product is None:
        raise HTTPException(404, "Product not found")
    return product


@router.patch("/products/{product_id}")
async def patch_product(product_id: int, body: ProductUpdate) -> dict:
    return _catalog(
        lambda: db.update_product(
            product_id,
            title=body.title,
            asin=body.asin,
            image_url=body.image_url,
            product_url=body.product_url,
            category_breadcrumbs=body.category_breadcrumbs,
        )
    )


@router.post("/products/{product_id}/tcg-confirm")
async def confirm_product_tcg(product_id: int, body: TcgConfirm) -> dict:
    return _catalog(lambda: db.confirm_tcg_candidate(product_id, body.candidate_id))


@router.get("/products/{product_id}/compare")
async def compare_product(product_id: int) -> dict:
    compared = db.product_compare(product_id)
    if compared is None:
        raise HTTPException(404, "Product not found")
    if compared["status"] != "matched":
        raise HTTPException(409, "Confirm a TCGPlayer listing before comparing prices")
    return compared


@router.delete("/products/{product_id}/tcg-match")
async def clear_product_tcg_match(product_id: int) -> dict:
    _catalog(lambda: db.clear_tcg_match(product_id))
    product = db.get_product(product_id)
    if product is None:
        raise HTTPException(404, "Product not found")
    return product


@router.delete("/products/{product_id}")
async def remove_product(product_id: int, force: bool = False) -> dict:
    _catalog(lambda: db.delete_product(product_id, force=force))
    return {"ok": True}


@router.delete("/observations/{observation_id}")
async def remove_observation(observation_id: int) -> dict:
    job_id = _catalog(lambda: db.delete_observation(observation_id))
    return {"ok": True, "job_id": job_id}


@router.get("/exports/{kind}")
async def download_export(
    kind: str,
    format: str = "csv",
    job_id: int | None = None,
    product_id: int | None = None,
    q: str | None = None,
    min_price: float | None = None,
    max_price: float | None = None,
    min_rating: float | None = None,
    min_bought: int | None = None,
    sort: str = "page",
    has_asin: str | None = None,
    last_seen_after: str | None = None,
    last_seen_before: str | None = None,
    limit: int = 500,
    offset: int = 0,
):
    if kind not in exports.DATASETS:
        raise HTTPException(404, "Unknown export")
    if format not in {"csv", "xlsx", "json"}:
        raise HTTPException(400, "format must be csv, xlsx, or json")
    if sort not in SORTS:
        raise HTTPException(400, "Unknown sort")
    if has_asin not in {None, "", "yes", "no", "any"}:
        raise HTTPException(400, "has_asin must be yes, no, or any")
    if job_id is not None and db.get_job(job_id) is None:
        raise HTTPException(404, "Job not found")
    if product_id is not None:
        state = exports.product_match_state(product_id)
        if state is None:
            raise HTTPException(404, "Product not found")
        if kind == "price-compare" and state != "matched":
            raise HTTPException(409, "Confirm a TCGPlayer listing before comparing prices")
    try:
        after, before = _seen_bounds(last_seen_after, last_seen_before)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    query = q.strip() if q else None
    asin_filter = None if has_asin in {None, "", "any"} else has_asin
    if kind == "amazon-products":
        columns, rows, sheet = exports.amazon_rows(
            job_id=job_id,
            product_id=product_id,
            q=query,
            min_price=min_price,
            max_price=max_price,
            min_rating=min_rating,
            min_bought=min_bought,
            sort=sort,
            has_asin=asin_filter,
            last_seen_after=after,
            last_seen_before=before,
        )
    elif kind == "tcgplayer-matches":
        columns, sheet = exports.TCG_COLUMNS, "TCGPlayer matches"
        rows = exports.tcg_rows(
            job_id=job_id,
            product_id=product_id,
            q=query,
            min_price=min_price,
            max_price=max_price,
            min_rating=min_rating,
            min_bought=min_bought,
            has_asin=asin_filter,
            last_seen_after=after,
            last_seen_before=before,
        )
    else:
        columns, sheet = exports.COMPARE_COLUMNS, "Price compare"
        rows = exports.price_compare_rows(
            job_id=job_id,
            product_id=product_id,
            q=query,
            min_price=min_price,
            max_price=max_price,
            min_rating=min_rating,
            min_bought=min_bought,
            has_asin=asin_filter,
            last_seen_after=after,
            last_seen_before=before,
        )
    if format == "json":
        bounded = max(1, min(limit, 1000))
        start = max(0, offset)
        return {"total": len(rows), "items": rows[start : start + bounded]}
    extension = "csv" if format == "csv" else "xlsx"
    filename = exports.export_filename(kind, extension, job_id=job_id)
    if format == "csv":
        payload = exports.render_csv(columns, rows)
        media = "text/csv; charset=utf-8"
    else:
        payload = exports.render_xlsx(columns, rows, sheet_name=sheet)
        media = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    return Response(
        content=payload,
        media_type=media,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _public_job(job: dict) -> dict:
    settings = dict(job.get("settings") or {})
    secret = settings.get("proxy_password") or ""
    settings["proxy_password_set"] = bool(secret)
    settings["proxy_password"] = ""
    copied = dict(job)
    copied["settings"] = settings
    return copied


def _seen_bounds(after: str | None, before: str | None) -> tuple[str | None, str | None]:
    from datetime import date, timedelta

    def parse_day(value: str | None, end: bool) -> str | None:
        if not value or not value.strip():
            return None
        raw = value.strip()
        if len(raw) == 10:
            day = date.fromisoformat(raw)
            if end:
                return (day + timedelta(days=1)).isoformat()
            return day.isoformat()
        return raw

    return parse_day(after, False), parse_day(before, True)


def _catalog(action):
    try:
        return action()
    except LookupError as exc:
        raise HTTPException(404, "Not found") from exc
    except (db.CatalogError, db.JobStateError) as exc:
        raise HTTPException(409, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


def _run(action):
    try:
        result = action()
    except LookupError as exc:
        raise HTTPException(404, "Job not found") from exc
    except db.JobStateError as exc:
        raise HTTPException(409, str(exc)) from exc
    if isinstance(result, dict) and "status" in result and "settings" in result:
        return _public_job(result)
    return result
