"""Request bodies for the operator API."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class JobCreate(BaseModel):
    mode: Literal["url", "search", "fixture"]
    start_url: str | None = None
    search_query: str | None = None
    search_terms: str | None = None
    min_price: float | None = None
    max_price: float | None = None
    department: str | None = "all"
    max_pages: int | None = Field(default=None, ge=1, le=20)
    delay_sec: float | None = Field(default=None, ge=0, le=60)
    headless: bool | None = None
    fixture_set: Literal["pokemon", "captcha", "pagecap", "showmore"] | None = None


class SettingsUpdate(BaseModel):
    delay_sec: float = Field(ge=1, le=60)
    max_pages: int = Field(ge=1, le=20)
    headless: bool
