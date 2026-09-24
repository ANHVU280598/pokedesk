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
