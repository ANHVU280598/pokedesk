"""Catalog Desk API. The worker lives in this process."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app import db, settings_store
from app.config import ROOT, database_path, settings_path
from app.routes import router
from app.scraper.runner import JobRunner

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init_db(database_path())
    settings_store.init(settings_path())
    db.fail_interrupted()
    runner = JobRunner()
    app.state.runner = runner
    await runner.start()
    try:
        yield
    finally:
        await runner.stop()
        db.close_db()


app = FastAPI(title="Catalog Desk", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(router)

_dist = ROOT / "frontend" / "dist"
if _dist.is_dir():
    app.mount("/", StaticFiles(directory=_dist, html=True), name="ui")
else:

    @app.get("/")
    async def root() -> dict:
        return {
            "app": "Catalog Desk",
            "docs": "/docs",
            "ui": "http://127.0.0.1:43123",
        }
