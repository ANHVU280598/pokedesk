"""Paths for the local ledger. Override with env vars in tests."""

from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "data"


def database_path() -> Path:
    override = os.environ.get("SCRAPE_DB_PATH")
    if override:
        return Path(override)
    return DATA_DIR / "scrape.db"


def settings_path() -> Path:
    override = os.environ.get("SCRAPE_SETTINGS_PATH")
    if override:
        return Path(override)
    return DATA_DIR / "settings.json"
