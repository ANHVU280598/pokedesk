"""Operator defaults, stored as JSON beside the SQLite file.

Job rows snapshot these into settings_json when a scrape starts. This file is
not part of the scrape schema.
"""

from __future__ import annotations

import json
from pathlib import Path

_path: Path | None = None

DEFAULTS = {
    "delay_sec": 2.5,
    "max_pages": 3,
    "headless": True,
    "proxy_enabled": False,
    "proxy_url": "",
    "proxy_username": "",
    "proxy_password": "",
    "expand_related": True,
    "related_cards_limit": 3,
    "recheck_after_block": True,
}


def init(path: Path) -> None:
    global _path
    _path = path


def _file() -> Path:
    if _path is None:
        raise RuntimeError("Settings store is not initialized")
    return _path


def get() -> dict:
    path = _file()
    if not path.exists():
        return dict(DEFAULTS)
    stored = json.loads(path.read_text(encoding="utf-8"))
    merged = dict(DEFAULTS)
    merged.update({key: stored[key] for key in DEFAULTS if key in stored})
    return merged


def put(values: dict) -> dict:
    current = get()
    current.update(values)
    path = _file()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(current, indent=2) + "\n", encoding="utf-8")
    return current


def public(values: dict | None = None) -> dict:
    """Settings for the API. The password stays in the file and is not echoed."""
    data = dict(values if values is not None else get())
    secret = data.get("proxy_password") or ""
    data["proxy_password_set"] = bool(secret)
    data["proxy_password"] = ""
    return data
