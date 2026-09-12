"""Read a listing page over plain HTTP, with no browser.

This is the whole of the mechanism that pulled twenty-five NoBroker listings and
twelve from RealEstateIndia during the survey on 2026-09-11. There was no
cleverness in it and that is the point:

    GET the URL with an ordinary browser User-Agent
    -> the server returns HTML
    -> the HTML is flattened to text, with links and image sources kept inline
    -> the model reads that text and fills in the schema

No headless browser, no rendering, no automation framework. The portals that
answered did so because they chose to serve their HTML to whoever asked.

Why this exists next to the Playwright crawler
----------------------------------------------
Chromium wants roughly 400MB the moment it launches. On a 512MB instance that
is refused with SIGKILL, so `capacity.headless_available()` now declines to
start it at all — which left the crawler switched off and searches returning
only Khoj's own listings.

But the portals that work never needed a browser. Measured with a plain GET:

    nobroker         200   923KB   54 rent-like strings, 36 images
    realestateindia  200   281KB   24 listing links,     30 images
    squareyards      200   687KB   50 rent-like strings, 226 images

All of that is in the HTML before a single line of script runs. Reading it this
way costs a few megabytes instead of four hundred, so it works on the small
instance where the browser cannot, and it finishes in a second rather than
thirty.

The browser is still the right tool for a page that genuinely builds itself on
the client, and for signed-in sessions where numbers have to be revealed by
clicking. It is simply no longer the *first* thing tried.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from html import unescape
from html.parser import HTMLParser
from urllib.parse import urljoin

import httpx

from app.config import settings

log = logging.getLogger(__name__)

#: An ordinary desktop Chrome UA.
#:
#: Not a disguise, and worth being plain about: many servers return a stripped
#: page, or none, to a client that sends no User-Agent at all, and httpx's
#: default announces a library rather than a reader. This is the same string a
#: person's browser sends. Hosts that decline automated readers — 99acres
#: answers 403, Housing 406 — still decline, and that answer is respected by
#: leaving them out of the search rather than dressed around.
USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)

HEADERS = {
    "User-Agent": USER_AGENT,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-IN,en;q=0.9",
}

#: Elements whose contents are code or styling rather than anything to read.
_SKIP = {"script", "style", "noscript", "svg", "template", "iframe", "canvas"}

#: Elements that end a line, so listings do not run into each other as one
#: unreadable paragraph and the model can tell where one property stops.
_BREAK = {
    "p", "div", "li", "tr", "br", "h1", "h2", "h3", "h4", "h5", "h6",
    "section", "article", "header", "footer", "td", "table", "ul", "ol",
}

#: Above this, the response is not a listing page — it is a download.
MAX_BYTES = 8_000_000


class _Flattener(HTMLParser):
    """HTML to text, keeping the URLs.

    The URLs are the reason this is not a one-line regex strip. A listing's own
    link and its photograph live in `href` and `src` attributes, never in the
    visible text, so a naive flatten throws away the two fields that make a
    result verifiable — and the extractor checks every URL it reports against
    this text, so a link absent here is a link that gets dropped.

    Relative paths are resolved against the page they came from. NoBroker's
    detail links are written as `/property/...`, and a bare path is not a URL
    the customer can open or the extractor can validate.
    """

    def __init__(self, base_url: str) -> None:
        super().__init__(convert_charrefs=True)
        self.base = base_url
        self.parts: list[str] = []
        self._skip_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in _SKIP:
            self._skip_depth += 1
            return
        if self._skip_depth:
            return

        values = dict(attrs)
        if tag == "a" and values.get("href"):
            self.parts.append(f" <{self._absolute(values['href'])}> ")
        elif tag == "img":
            # `src` last: a lazy-loading gallery puts a grey placeholder in
            # `src` and the real photograph in `data-src`, so preferring src
            # would collect a page of identical spacer images.
            raw = (
                values.get("data-src")
                or values.get("data-original")
                or values.get("data-lazy-src")
                or values.get("src")
            )
            if raw:
                self.parts.append(f" [image: {self._absolute(raw)}] ")
            if values.get("alt"):
                self.parts.append(f" {values['alt']} ")
        if tag in _BREAK:
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in _SKIP:
            self._skip_depth = max(0, self._skip_depth - 1)
        elif tag in _BREAK:
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        if not self._skip_depth and data.strip():
            self.parts.append(data)

    def _absolute(self, href: str) -> str:
        try:
            return urljoin(self.base, href.strip())
        except ValueError:
            return href.strip()

    def text(self) -> str:
        joined = unescape("".join(self.parts))
        joined = re.sub(r"[ \t\r\f\v]+", " ", joined)
        joined = re.sub(r"\n\s*\n\s*\n+", "\n\n", joined)
        return joined.strip()


def html_to_text(html: str, base_url: str) -> str:
    """Flatten a page to readable text with its links and images intact."""
    parser = _Flattener(base_url)
    try:
        parser.feed(html)
        parser.close()
    except Exception:  # noqa: BLE001 - malformed markup is normal on the web
        log.debug("http_reader: parser stopped early on %s", base_url, exc_info=True)
    return parser.text()


@dataclass(frozen=True, slots=True)
class HttpPage:
    """What a plain GET returned."""

    url: str
    status: int
    text: str

    @property
    def looks_like_listings(self) -> bool:
        """Whether this is worth handing to the extractor.

        A shell page — the client-rendered kind — comes back as a few hundred
        characters of navigation with no prices in it. Sending that to the model
        costs a call to be told there is nothing there, and more usefully, a
        `False` here is the signal to try the browser instead.
        """
        if len(self.text) < 600:
            return False
        return bool(re.search(r"(?:₹|Rs\.?\s?|INR\s?)\s?[\d,]{4,}", self.text))


async def fetch_page(url: str, *, timeout_s: float | None = None) -> HttpPage | None:
    """GET a page and flatten it. None when the host would not serve it.

    Never raises. A portal that refuses, redirects into a loop, or times out is
    one portal missing from a search, not a failed search — and certainly not a
    reason to take down the worker.
    """
    timeout = timeout_s if timeout_s is not None else settings.http_read_timeout_s

    try:
        async with httpx.AsyncClient(
            follow_redirects=True, timeout=timeout, headers=HEADERS
        ) as client:
            response = await client.get(url)
    except (httpx.HTTPError, ValueError) as exc:
        log.info("http_reader: %s did not answer (%s)", url, type(exc).__name__)
        return None

    if response.status_code >= 400:
        # 403 and 406 are the hosts that decline automated readers. Logged at
        # info, not warning: it is their answer, it is not going to change, and
        # it is not a fault of ours to be fixed.
        log.info("http_reader: %s answered %d", url, response.status_code)
        return None

    if len(response.content) > MAX_BYTES:
        log.info("http_reader: %s returned %d bytes — too large", url, len(response.content))
        return None

    content_type = response.headers.get("content-type", "")
    if content_type and "html" not in content_type.lower():
        log.info("http_reader: %s is %s, not HTML", url, content_type)
        return None

    final = str(response.url)
    return HttpPage(url=final, status=response.status_code, text=html_to_text(response.text, final))
