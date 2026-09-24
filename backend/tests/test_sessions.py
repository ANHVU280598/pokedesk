import asyncio

from app.scraper.sessions import PlaywrightSession


class _Response:
    status = 200


class _Page:
    def __init__(self) -> None:
        self.gotos: list[str] = []
        self.selectors: list[str] = []
        self.url = "about:blank"

    def set_default_timeout(self, _ms: int) -> None:
        return None

    async def goto(self, url: str, **_kwargs) -> _Response:
        self.gotos.append(url)
        self.url = url
        return _Response()

    async def wait_for_selector(self, selector: str, timeout: int | None = None) -> None:
        self.selectors.append(selector)
        return None

    async def content(self) -> str:
        return "<html><body>ok</body></html>"


def test_related_visits_and_recheck_reuse_one_page():
    """Product cards and the results list are gotos on the crawl's page."""
    session = PlaywrightSession()
    page = _Page()
    browser = object()
    context = object()
    session._browser = browser
    session._context = context
    session._page = page

    results = "https://www.amazon.com/s?k=pokemon+cards"
    product = "https://www.amazon.com/dp/B0SEED0001"
    again = "https://www.amazon.com/s?k=pokemon+cards&page=2"

    async def run() -> None:
        await session.get(results)
        await session.get(product)
        await session.get(again)

    asyncio.run(run())

    assert page.gotos == [results, product, again]
    assert session._browser is browser
    assert session._context is context
    assert session._page is page
    assert "s-search-result" in page.selectors[0]
    assert "#productTitle" in page.selectors[1]
    assert "s-search-result" not in page.selectors[1]
    assert "s-search-result" in page.selectors[2]
