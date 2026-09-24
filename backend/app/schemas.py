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
    max_pages: int | None = Field(default=None, ge=1)
    delay_sec: float | None = Field(default=None, ge=0, le=60)
    headless: bool | None = None
    fixture_set: Literal["pokemon", "captcha", "pagecap", "showmore", "relatedcap"] | None = None
    proxy_mode: Literal["default", "off", "custom"] = "default"
    expand_related: bool | None = None
    related_cards_limit: int | None = Field(default=None, ge=1, le=20)
    recheck_after_block: bool | None = None
    proxy_url: str | None = None
    proxy_username: str | None = None
    proxy_password: str | None = None


class SettingsUpdate(BaseModel):
    delay_sec: float = Field(ge=1, le=60)
    max_pages: int = Field(ge=1)
    headless: bool
    proxy_enabled: bool = False
    proxy_url: str = ""
    proxy_username: str = ""
    proxy_password: str = ""
    clear_proxy_password: bool = False
    expand_related: bool = True
    related_cards_limit: int = Field(default=3, ge=1, le=20)
    recheck_after_block: bool = True


class FollowUpCreate(BaseModel):
    suggestion_ids: list[str] = Field(min_length=1)


class RecheckBody(BaseModel):
    mode: Literal["continue", "reload"] = "continue"


class ProductUpdate(BaseModel):
    title: str = Field(min_length=1, max_length=500)
    asin: str | None = None
    image_url: str | None = None
    product_url: str | None = None
    category_breadcrumbs: str | None = None


class ProductMerge(BaseModel):
    keep_id: int
    drop_id: int


class TcgMatchBody(BaseModel):
    product_ids: list[int] | None = None


class ProductTcgMatch(BaseModel):
    product_ids: list[int] = Field(min_length=1, max_length=500)
