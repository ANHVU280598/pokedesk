"""Scrape one Amazon page and one TCGPlayer product page for a manual link.

A manual match is confirmed by the operator. Batch matching does not replace it.
"""

from __future__ import annotations

import asyncio
import logging

from app import db, settings_store
from app.links import LinkError, amazon_product_url, tcg_product_url
from app.scraper.product_page import ProductPageError as AmazonPageError
from app.scraper.product_page import parse_amazon_product_page
from app.service import playwright_proxy
from app.tcg.product_page import ProductPageError as TcgPageError
from app.tcg.product_page import parse_tcg_product_page
from app.tcg.search import page_is_blocked

log = logging.getLogger("app.manual")

TCG_READY = (
    "h1.tcg-product-title, main h1, h1, "
    "#challenge-running, form[action*='challenge'], .cf-error-details"
)


class ManualError(Exception):
    """Shown to the operator. Nothing was written when this is raised."""


async def link_tcg_url(product_id: int, url: str) -> dict:
    if db.get_product(product_id) is None:
        raise LookupError(product_id)
    try:
        canonical, product_key = tcg_product_url(url)
    except LinkError as exc:
        raise ManualError(str(exc)) from exc
    html, status = (await fetch_documents([(canonical, "tcg")]))[0]
    parsed = _read_tcg(html, canonical, status, product_key)
    saved = db.save_manual_tcg(product_id, parsed)
    print(
        f"Manual TCGPlayer match product={product_id} url={canonical} price={parsed.get('price')}",
        flush=True,
    )
    log.info("Manual TCGPlayer match product=%s url=%s", product_id, canonical)
    return saved


async def link_pair(amazon_url: str, tcg_url: str) -> dict:
    try:
        amazon_canonical, asin = amazon_product_url(amazon_url)
        tcg_canonical, product_key = tcg_product_url(tcg_url)
    except LinkError as exc:
        raise ManualError(str(exc)) from exc
    documents = await fetch_documents([(amazon_canonical, "amazon"), (tcg_canonical, "tcg")])
    amazon_html, amazon_status = documents[0]
    if amazon_status in {403, 429, 503}:
        raise ManualError(f"Amazon returned HTTP {amazon_status}. Nothing was saved.")
    try:
        card = parse_amazon_product_page(amazon_html, amazon_canonical, asin=asin)
    except AmazonPageError as exc:
        raise ManualError(str(exc)) from exc
    if len(documents) < 2:
        raise ManualError("The TCGPlayer page was not opened. Nothing was saved.")
    tcg_html, tcg_status = documents[1]
    parsed = _read_tcg(tcg_html, tcg_canonical, tcg_status, product_key)
    product_id = db.store_manual_amazon(card)
    saved = db.save_manual_tcg(product_id, parsed)
    print(
        f"Manual pair product={product_id} asin={asin} tcg={tcg_canonical}",
        flush=True,
    )
    log.info("Manual pair product=%s asin=%s tcg=%s", product_id, asin, tcg_canonical)
    return saved


def _read_tcg(html: str, url: str, status: int | None, product_key: str) -> dict:
    if page_is_blocked(html, status):
        raise ManualError("TCGPlayer blocked this page. Nothing was saved.")
    try:
        parsed = parse_tcg_product_page(html, url, status=status)
    except TcgPageError as exc:
        raise ManualError(str(exc)) from exc
    parsed["tcg_product_id"] = product_key
    return parsed


async def fetch_documents(pages: list[tuple[str, str]]) -> list[tuple[str, int | None]]:
    """Load each URL on one browser session. ``pages`` is (url, kind)."""
    from app.scraper.sessions import PlaywrightSession

    settings = settings_store.get()
    delay = float(settings.get("delay_sec") or 2.5)
    if delay < 1:
        delay = 1.0
    session = await PlaywrightSession.launch(
        headless=bool(settings.get("headless", True)),
        proxy=playwright_proxy(settings),
    )
    loaded: list[tuple[str, int | None]] = []
    try:
        for index, (url, kind) in enumerate(pages):
            if index:
                await asyncio.sleep(delay)
            ready = TCG_READY if kind == "tcg" else None
            html = await session.get(url, ready=ready)
            status = session.last_status
            loaded.append((html, status))
            if kind == "amazon" and not _amazon_readable(html, url, status):
                break
            if kind == "tcg" and page_is_blocked(html, status):
                break
    finally:
        await session.close()
    return loaded


def _amazon_readable(html: str, url: str, status: int | None) -> bool:
    if status in {403, 429, 503}:
        return False
    try:
        _asin = url.rsplit("/", 1)[-1]
        parse_amazon_product_page(html, url, asin=_asin)
    except AmazonPageError:
        return False
    return True
