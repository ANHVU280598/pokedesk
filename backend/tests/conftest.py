import pytest
from fastapi.testclient import TestClient

from app import db
from app.main import app


@pytest.fixture
def database(tmp_path):
    db.init_db(tmp_path / "scrape.db")
    yield tmp_path / "scrape.db"
    db.close_db()


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("SCRAPE_DB_PATH", str(tmp_path / "scrape.db"))
    monkeypatch.setenv("SCRAPE_SETTINGS_PATH", str(tmp_path / "settings.json"))

    async def _no_live_browser(*_args, **_kwargs):
        raise RuntimeError("live browser disabled in tests")

    monkeypatch.setattr(
        "app.scraper.runner.PlaywrightSession.launch",
        _no_live_browser,
    )
    with TestClient(app) as test_client:
        yield test_client
