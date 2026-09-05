"""Async Playwright crawler.

Renders JavaScript-heavy listing pages and returns sanitised text for the LLM
extractor. Deliberately plain: it identifies itself honestly in the User-Agent,
sends no forged fingerprints, and does not attempt to defeat bot detection or
CAPTCHAs. A site that does not want to be read automatically returns
``BLOCKED`` with a reason, and the pipeline reports that to the customer instead
of pretending the site was empty.

One page per target, on the customer's instruction. It does not follow links and
is not a crawler in the spidering sense.
"""

from __future__ import annotations

import asyncio
import logging
import re
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, AsyncIterator
from urllib.parse import urlparse

from app.config import settings
from app.models import ListingSourceStatus, TargetSite

if TYPE_CHECKING:
    from playwright.async_api import Browser, Page

log = logging.getLogger(__name__)

#: Markers that mean "we know you are a robot", not "the page is empty".
_BLOCK_MARKERS = (
    "verify you are human",
    "are you a robot",
    "unusual traffic",
    "access denied",
    "captcha",
    "cf-challenge",
    "request blocked",
    "enable javascript and cookies",
)

#: Markers that mean the listing exists but the number does not.
_GATE_MARKERS = (
    "view contact",
    "get owner details",
    "login to view",
    "sign in to view",
    "get phone no",
    "view phone",
    "unlock owner details",
)

_PRIVATE_HOST = re.compile(
    r"^(localhost$|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?$)"
)


@dataclass(slots=True)
class PageResult:
    """One fetched page."""

    site: TargetSite
    status: ListingSourceStatus
    text: str = ""
    note: str = ""
    final_url: str | None = None
    #: True when a "reveal number" control was seen — the listings are readable
    #: but the contacts are not.
    contact_gated: bool = False
    screenshots: list[str] = field(default_factory=list)


def _is_private(url: str) -> bool:
    """Refuse URLs that would make the server fetch its own private network.

    Without this a submitted URL is a server-side request forgery. ``169.254.x``
    is on the list specifically because cloud metadata services live there.
    """
    host = urlparse(url).hostname or ""
    return bool(_PRIVATE_HOST.match(host))


def sanitise(html: str) -> str:
    """HTML to readable text.

    Scripts and styles are removed rather than stripped of tags, because a
    ``<script>`` containing a ten-digit tracking id would otherwise look exactly
    like a phone number to the extractor.
    """
    text = re.sub(r"<script\b[\s\S]*?</script>", " ", html, flags=re.I)
    text = re.sub(r"<style\b[\s\S]*?</style>", " ", text, flags=re.I)
    text = re.sub(r"<noscript\b[\s\S]*?</noscript>", " ", text, flags=re.I)
    text = re.sub(r"<!--[\s\S]*?-->", " ", text)
    text = re.sub(r"<br\s*/?>", "\n", text, flags=re.I)
    text = re.sub(r"</(p|div|li|tr|h[1-6]|section|article)>", "\n", text, flags=re.I)
    text = re.sub(r"<[^>]+>", " ", text)
    text = (
        text.replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&#8377;", "Rs ")
        .replace("₹", "Rs ")
    )
    text = re.sub(r"[ \t ]+", " ", text)
    text = re.sub(r"\n\s*\n\s*\n+", "\n\n", text)
    return text.strip()


@asynccontextmanager
async def browser_session() -> AsyncIterator["Browser"]:
    """A headless Chromium for the life of one search.

    Launching a browser costs a second or two, so one instance is shared across
    all five sites and each page gets its own isolated context.
    """
    from playwright.async_api import async_playwright

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(
            headless=True,
            args=["--disable-dev-shm-usage", "--no-sandbox"],
        )
        try:
            yield browser
        finally:
            await browser.close()


async def _settle(page) -> None:  # type: ignore[no-untyped-def]
    """Scroll a few screens so lazy-loaded cards render.

    Portals load the first handful of results and fetch the rest on scroll, so
    reading without scrolling reports a fraction of what a person would see.
    Failures are swallowed: a page that cannot be scrolled is still worth
    reading.
    """
    try:
        for _ in range(3):
            await page.mouse.wheel(0, 4_000)
            await page.wait_for_timeout(1_200)
        await page.wait_for_timeout(1_500)
    except Exception:  # noqa: BLE001 - scrolling is an optimisation, not a step
        pass


async def _read_page(browser: "Browser", site: TargetSite) -> PageResult:
    """Fetch and sanitise one page."""
    url = str(site.url)

    if _is_private(url):
        return PageResult(
            site=site,
            status=ListingSourceStatus.ERROR,
            note="That address is on a private network.",
        )

    context = await browser.new_context(
        user_agent=settings.user_agent,
        viewport={"width": 1440, "height": 2200},
        locale="en-IN",
        java_script_enabled=True,
    )
    page: Page = await context.new_page()

    # Images and fonts double the load time and carry nothing the extractor can
    # read. Stylesheets are dropped for the same reason.
    async def _skip_assets(route, request):  # type: ignore[no-untyped-def]
        if request.resource_type in {"image", "font", "media", "stylesheet"}:
            await route.abort()
        else:
            await route.continue_()

    await page.route("**/*", _skip_assets)

    try:
        response = await page.goto(
            url, wait_until="domcontentloaded", timeout=settings.scrape_timeout_ms
        )

        # Listing grids hydrate after first paint; settle briefly rather than
        # waiting on networkidle, which portals with polling never reach.
        try:
            await page.wait_for_load_state("networkidle", timeout=6_000)
        except Exception:  # noqa: BLE001 - a busy page is normal, not an error
            await page.wait_for_timeout(2_000)

        await _settle(page)
        html = await page.content()
        final_url = page.url
        http_status = response.status if response else 0

    except Exception as exc:  # noqa: BLE001 - normalise every Playwright error
        log.warning("crawler: %s unreachable (%s)", site.name, exc)
        return PageResult(
            site=site,
            status=ListingSourceStatus.ERROR,
            note=f"Could not load that page: {str(exc)[:120]}",
        )
    finally:
        await context.close()

    text = sanitise(html)
    lowered = text[:20_000].lower()

    if http_status in (401, 403, 406, 429, 451) or any(m in lowered for m in _BLOCK_MARKERS):
        return PageResult(
            site=site,
            status=ListingSourceStatus.BLOCKED,
            text=text,
            final_url=final_url,
            note=(
                f"{site.name} refused an automated reader"
                + (f" (HTTP {http_status})" if http_status else "")
                + ". Open the listing yourself and paste the URL or the text instead."
            ),
        )

    if len(text) < 400:
        return PageResult(
            site=site,
            status=ListingSourceStatus.EMPTY,
            text=text,
            final_url=final_url,
            note="That page loaded but had almost no readable content.",
        )

    gated = any(m in lowered for m in _GATE_MARKERS) or site.contact_gated
    return PageResult(
        site=site,
        status=ListingSourceStatus.CONTACT_GATED if gated else ListingSourceStatus.OK,
        text=text,
        final_url=final_url,
        contact_gated=gated,
        note=(
            f"{site.name} keeps contact numbers behind a login, so listings may "
            "arrive without a number to dial."
            if gated
            else f"Read {len(text):,} characters."
        ),
    )


async def crawl(sites: list[TargetSite]) -> list[PageResult]:
    """Fetch every target, bounded concurrency, never raising.

    A failure on one site is recorded as a result rather than propagated: a
    five-site search should return four sites' worth of listings when one portal
    is down.
    """
    if not sites:
        return []

    gate = asyncio.Semaphore(settings.scrape_concurrency)

    try:
        async with browser_session() as browser:

            async def one(site: TargetSite) -> PageResult:
                async with gate:
                    return await _read_page(browser, site)

            results = await asyncio.gather(*(one(s) for s in sites), return_exceptions=True)
    except Exception as exc:  # noqa: BLE001 - the browser itself would not start
        # Chromium missing or out of memory. Common on small hosts, where a
        # headless browser does not fit in 512 MB. Report it per site with a
        # usable next step rather than failing the whole search with a stack
        # trace the customer cannot act on.
        log.error("crawler: could not start a browser (%s)", exc)
        note = (
            "The page reader could not start on this server — it needs Chromium "
            "and more memory than is available. Paste the listing text or a "
            "listing URL instead."
        )
        return [
            PageResult(site=site, status=ListingSourceStatus.ERROR, note=note)
            for site in sites
        ]

    out: list[PageResult] = []
    for site, result in zip(sites, results, strict=True):
        if isinstance(result, BaseException):
            log.exception("crawler: %s raised", site.name, exc_info=result)
            out.append(
                PageResult(
                    site=site,
                    status=ListingSourceStatus.ERROR,
                    note=f"Crawler failed: {str(result)[:120]}",
                )
            )
        else:
            out.append(result)
    return out
