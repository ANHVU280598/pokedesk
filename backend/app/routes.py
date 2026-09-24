"""Operator HTTP API."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request

from app import db, settings_store
from app.schemas import JobCreate, SettingsUpdate
from app.service import clean_settings, compose_new_job, retry_wait_seconds

router = APIRouter(prefix="/api")

SORTS = {"page", "recent", "price_asc", "price_desc", "rating"}


@router.get("/health")
async def health() -> dict:
    return {"ok": True}


@router.get("/settings")
async def read_settings() -> dict:
    return settings_store.get()


@router.put("/settings")
async def write_settings(body: SettingsUpdate) -> dict:
    try:
        return settings_store.put(clean_settings(body))
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post("/jobs", status_code=201)
async def create_job(body: JobCreate, request: Request) -> dict:
    try:
        spec = compose_new_job(body, settings_store.get())
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    job = db.create_job(**spec)
    request.app.state.runner.notify()
    return job


@router.get("/jobs")
async def list_jobs() -> list[dict]:
    return db.list_jobs()


@router.get("/jobs/{job_id}")
async def read_job(job_id: int) -> dict:
    job = db.get_job(job_id)
    if job is None:
        raise HTTPException(404, "Job not found")
    return job


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
    return queued


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


@router.get("/products/{product_id}")
async def read_product(product_id: int) -> dict:
    product = db.get_product(product_id)
    if product is None:
        raise HTTPException(404, "Product not found")
    return product


def _run(action):
    try:
        return action()
    except LookupError as exc:
        raise HTTPException(404, "Job not found") from exc
    except db.JobStateError as exc:
        raise HTTPException(409, str(exc)) from exc
