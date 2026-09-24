"""Page fetchers: Playwright for Amazon, local HTML for fixture dry-runs.

Live fetches use a normal desktop browser context. This module does not
change the user agent, click random products, or otherwise evade detection.
"""

from __future__ import annotations

import logging
import re

from app.scraper.fixtures import load_bundle

logger = logging.getLogger(__name__)

_SHOW_MORE = re.compile(
    r"^\s*(show more results|show more|load more results|load more)\s*$",
    re.IGNORECASE,
)


def _page_number(url: str) -> int:
    match = re.search(r"/(\d+)$", url)
    return int(match.group(1)) if match else 1


class FixtureSession:
    """Replay a saved result set, including a second page."""

    def __init__(self, bundle: str):
        self.bundle = bundle
        self.pages = load_bundle(bundle)
        self.url = f"fixture://{bundle}/1"
        self.last_status: int | None = 200

    async def get(self, url: str) -> str:
        self.url = url
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
    def __init__(self) -> None:
        self._pw = None
        self._browser = None
        self._page = None
        self._url = ""
        self.last_status: int | None = None

    @classmethod
    async def launch(cls, *, headless: bool) -> PlaywrightSession:
        session = cls()
        try:
            from playwright.async_api import async_playwright

            session._pw = await async_playwright().start()
            session._browser = await session._pw.chromium.launch(headless=headless)
            context = await session._browser.new_context(
                locale="en-US",
                timezone_id="America/Los_Angeles",
                viewport={"width": 1366, "height": 900},
            )
            session._page = await context.new_page()
            session._page.set_default_timeout(20_000)
            return session
        except Exception:
            await session.close()
            raise

    async def get(self, url: str) -> str:
        assert self._page is not None
        response = await self._page.goto(
            url,
            wait_until="domcontentloaded",
            timeout=35_000,
        )
        self.last_status = response.status if response is not None else None
        try:
            await self._page.wait_for_selector(
                "[data-component-type='s-search-result'], #captchacharacters, form[action*='validateCaptcha']",
                timeout=12_000,
            )
        except Exception:
            logger.info("results selector not found at %s", url)
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
            self._page = None
            if self._pw is not None:
                try:
                    await self._pw.stop()
                except Exception:
                    logger.exception("stopping playwright")
                self._pw = None
