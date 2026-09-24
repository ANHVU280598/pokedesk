"""Saved HTML pages for the dry-run path and tests."""

from __future__ import annotations

from pathlib import Path

FIXTURE_DIR = Path(__file__).resolve().parents[1] / "fixtures"

BUNDLES: dict[str, dict[int, str]] = {
    "pokemon": {1: "pokemon_page_1.html", 2: "pokemon_page_2.html"},
    "captcha": {1: "captcha.html"},
    "pagecap": {1: "page_cap.html"},
    "showmore": {1: "showmore_page_1.html", 2: "showmore_page_2.html"},
}


def load_bundle(name: str) -> dict[int, str]:
    pages = BUNDLES.get(name)
    if pages is None:
        raise ValueError(f"Unknown fixture set: {name}")
    loaded: dict[int, str] = {}
    for number, filename in pages.items():
        loaded[number] = (FIXTURE_DIR / filename).read_text(encoding="utf-8")
    return loaded
