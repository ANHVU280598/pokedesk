"""Saved HTML pages for the dry-run path and tests."""

from __future__ import annotations

from pathlib import Path

FIXTURE_DIR = Path(__file__).resolve().parents[1] / "fixtures"

BUNDLES: dict[str, dict[int, str]] = {
    "pokemon": {1: "pokemon_page_1.html", 2: "pokemon_page_2.html"},
    "captcha": {1: "captcha.html"},
    "pagecap": {1: "page_cap.html", 2: "page_cap_page_2.html"},
    "showmore": {1: "showmore_page_1.html", 2: "showmore_page_2.html"},
    "relatedcap": {1: "relatedcap_page_1.html"},
}


def load_related_html() -> str:
    return (FIXTURE_DIR / "related_items.html").read_text(encoding="utf-8")


def load_bundle(name: str) -> dict[int, str]:
    pages = BUNDLES.get(name)
    if pages is None:
        raise ValueError(f"Unknown fixture set: {name}")
    loaded: dict[int, str] = {}
    for number, filename in pages.items():
        loaded[number] = (FIXTURE_DIR / filename).read_text(encoding="utf-8")
    return loaded
