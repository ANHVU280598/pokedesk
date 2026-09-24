"""Page fetchers: Playwright for Amazon, local HTML for fixture dry-runs.

A live job opens one Chromium browser, one context, and one page. Primary
crawl, related-item expansion, and the pattern recheck all navigate that page.
Cookies, storage, and the job proxy stay on that context. This module does not
open a second browser or context per card, change the user agent, or click
around to look human.
"""

from __future__ import annotations

import logging
import re

from app.scraper.fixtures import load_bundle, load_related_html

logger = logging.getLogger(__name__)

_SHOW_MORE = re.compile(
    r"^\s*(show more results|show more|load more results|load more)\s*$",
    re.IGNORECASE,
)
_PRODUCT_URL = re.compile(r"/(?:dp|gp/product)/", re.IGNORECASE)
_RESULTS_READY = (
    "[data-component-type='s-search-result'], #captchacharacters, "
    "form[action*='validateCaptcha']"
)
_PRODUCT_READY = (
    "#productTitle, #dp, #ppd, #similarities_feature_div, #sims-feature, "
    "#sp_detail, #purchase-sims-feature, #anonCarousel1, "
    "#captchacharacters, form[action*='validateCaptcha']"
)


def _page_number(url: str) -> int:
    match = re.search(r"/(\d+)$", url)
    return int(match.group(1)) if match else 1


class FixtureSession:
    """Replay a saved result set, including a second page."""

    def __init__(self, bundle: str):
        self.bundle = bundle
        self.pages = load_bundle(bundle)
        self.related_html = load_related_html()
        self.product_visits: list[str] = []
        self.url = f"fixture://{bundle}/1"
        self.last_status: int | None = 200

    async def get(self, url: str) -> str:
        self.url = url
        if _PRODUCT_URL.search(url or ""):
            self.product_visits.append(url)
            self.last_status = 200
            return self.related_html
        number = _page_number(url)
        html = self.pages.get(number)
        if html is None:
            raise FileNotFoundError(f"No fixture page {number} for {self.bundle}")
        self.last_status = 200
        return html

    async def show_more(self) -> str | None:
        number = _page_number(self.url) + 1
        html = self.pages.get(number)
        if html is None:
            return None
        self.url = f"fixture://{self.bundle}/{number}"
        self.last_status = 200
        return html

    def current_url(self) -> str:
        return self.url

    async def close(self) -> None:
        return None


class PlaywrightSession:
    """One browser, one context, and one page for an entire job run."""

    def __init__(self) -> None:
        self._pw = None
        self._browser = None
        self._context = None
        self._page = None
        self._url = ""
        self.last_status: int | None = None

    @classmethod
    async def launch(cls, *, headless: bool, proxy: dict | None = None) -> PlaywrightSession:
        """Launch once. Callers must reuse this session instead of launching again."""
        session = cls()
        try:
            from playwright.async_api import async_playwright

            session._pw = await async_playwright().start()
            launch_args: dict = {"headless": headless}
            if proxy:
                launch_args["proxy"] = proxy
            session._browser = await session._pw.chromium.launch(**launch_args)
            # Proxy is set on the browser. The context keeps cookies and storage
            # for every later goto in this job.
            session._context = await session._browser.new_context(
                locale="en-US",
                timezone_id="America/Los_Angeles",
                viewport={"width": 1366, "height": 900},
            )
            session._page = await session._context.new_page()
            session._page.set_default_timeout(20_000)
            return session
        except Exception:
            await session.close()
            raise

    async def get(self, url: str) -> str:
        """Load a URL on the existing page. Does not open a browser, context, or page."""
        assert self._page is not None
        response = await self._page.goto(
            url,
            wait_until="domcontentloaded",
            timeout=35_000,
        )
        self.last_status = response.status if response is not None else None
        product = bool(_PRODUCT_URL.search(url or ""))
        try:
            await self._page.wait_for_selector(
                _PRODUCT_READY if product else _RESULTS_READY,
                timeout=8_000 if product else 12_000,
            )
        except Exception:
            logger.info("page landmark not found at %s", url)
        self._url = self._page.url
        return await self._page.content()

    async def show_more(self) -> str | None:
        assert self._page is not None
        locator = self._page.locator("a, button").filter(has_text=_SHOW_MORE)
        count = await locator.count()
        if count == 0:
            return None
        before = await self._page.locator(
            "[data-component-type='s-search-result']"
        ).count()
        try:
            await locator.nth(count - 1).click(timeout=5_000)
        except Exception:
            logger.info("show-more control was not clickable at %s", self._url)
            return None
        try:
            await self._page.wait_for_function(
                "(prev) => document.querySelectorAll(\"[data-component-type='s-search-result']\").length > prev",
                arg=before,
                timeout=8_000,
            )
        except Exception:
            logger.info("show-more did not increase the result count")
        self._url = self._page.url
        return await self._page.content()

    def current_url(self) -> str:
        if self._page is not None:
            return self._page.url or self._url
        return self._url

    async def close(self) -> None:
        try:
            if self._browser is not None:
                await self._browser.close()
        except Exception:
            logger.exception("closing browser")
        finally:
            self._browser = None
            self._context = None
            self._page = None
            if self._pw is not None:
                try:
                    await self._pw.stop()
                except Exception:
                    logger.exception("stopping playwright")
                self._pw = None
