"""Operator HTTP API."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request

from app import db, followups, settings_store
from app.schemas import FollowUpCreate, JobCreate, ProductMerge, ProductUpdate, SettingsUpdate
from app.service import clean_settings, compose_new_job, retry_wait_seconds

router = APIRouter(prefix="/api")

SORTS = {"page", "recent", "price_asc", "price_desc", "rating"}


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


@router.get("/jobs/{job_id}/observations")
async def list_observations(
    job_id: int,
    q: str | None = None,
    min_price: float | None = None,
    max_price: float | None = None,
    min_rating: float | None = None,
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
    request.app.state.runner.notify()
    return {"jobs": [_public_job(item) for item in created]}


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


@router.delete("/products/{product_id}")
async def remove_product(product_id: int, force: bool = False) -> dict:
    _catalog(lambda: db.delete_product(product_id, force=force))
    return {"ok": True}


@router.delete("/observations/{observation_id}")
async def remove_observation(observation_id: int) -> dict:
    job_id = _catalog(lambda: db.delete_observation(observation_id))
    return {"ok": True, "job_id": job_id}


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
