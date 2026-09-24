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


class _Link:
    def __init__(self, page: "_ClickPage") -> None:
        self.page = page

    @property
    def first(self) -> "_Link":
        return self

    async def evaluate(self, _script: str) -> None:
        self.page.events.append("untarget")

    async def click(self, timeout: int | None = None) -> None:
        self.page.events.append("click")
        if self.page.fail_click:
            raise RuntimeError("not clickable")
        self.page.url = "https://www.amazon.com/dp/B0FROMCLICK"


class _Card:
    def __init__(self, page: "_ClickPage") -> None:
        self.page = page

    def locator(self, _selector: str) -> _Link:
        return _Link(self.page)


class _Cards:
    def __init__(self, page: "_ClickPage") -> None:
        self.page = page

    def nth(self, index: int) -> _Card:
        self.page.events.append(("nth", index))
        return _Card(self.page)


class _ClickPage(_Page):
    def __init__(self, fail_click: bool = False) -> None:
        super().__init__()
        self.fail_click = fail_click
        self.events: list = []

    def locator(self, selector: str) -> _Cards:
        self.events.append(("locator", selector))
        return _Cards(self)


def test_list_click_stays_on_the_same_page_and_falls_back_to_the_url():
    session = PlaywrightSession()
    page = _ClickPage()
    browser = object()
    context = object()
    session._browser = browser
    session._context = context
    session._page = page

    async def opened() -> str:
        return await session.open_result_card(2, "https://www.amazon.com/dp/B0SEED0002")

    html = asyncio.run(opened())
    assert html == "<html><body>ok</body></html>"
    assert ("nth", 1) in page.events
    assert "click" in page.events
    assert page.gotos == []
    assert session._page is page
    assert session._browser is browser
    assert session._context is context
    assert "/dp/B0FROMCLICK" in session.current_url()

    failed = _ClickPage(fail_click=True)
    session._page = failed

    async def fallback() -> str:
        return await session.open_result_card(2, "https://www.amazon.com/dp/B0SEED0002")

    asyncio.run(fallback())
    assert failed.gotos == ["https://www.amazon.com/dp/B0SEED0002"]
    assert session._browser is browser
    assert session._context is context
