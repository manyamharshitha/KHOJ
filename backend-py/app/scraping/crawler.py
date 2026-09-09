"""Async Playwright crawler.

Renders JavaScript-heavy listing pages and returns sanitised text for the LLM
extractor. Deliberately plain: it identifies itself honestly in the User-Agent,
sends no forged fingerprints, and does not attempt to defeat bot detection or
CAPTCHAs. A site that does not want to be read automatically returns
``BLOCKED`` with a reason, and the pipeline reports that to the customer instead
of pretending the site was empty.

One page per target, on the customer's instruction. It does not follow links and
is not a crawler in the spidering sense.

Where a session captured by ``scripts/generate_auth.py`` exists, the context is
created with that ``storage_state`` so the portal is read as the signed-in
account it belongs to, and the "View Contact" controls are clicked to reveal the
numbers behind them. That is a person's own logged-in session being replayed --
no credential is typed, no OTP is intercepted, and no bot check is defeated. It
is still automated access to an account, so it is rate-limited, capped per page,
and off entirely when no session file is present.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import time
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING, AsyncIterator
from urllib.parse import urlparse

from app.config import settings
from app.models import ListingSourceStatus, TargetSite

if TYPE_CHECKING:
    from playwright.async_api import Browser, Page

log = logging.getLogger(__name__)

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
    contact_gated: bool = False
    #: True when a saved signed-in session was replayed for this host.
    authenticated: bool = False
    #: How many gated numbers were actually revealed and written into the page.
    revealed_contacts: int = 0
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
        # Bounded, because this is the await that hangs rather than fails.
        # Chromium needs more memory than a small instance has, and when it
        # cannot get it the launch stalls instead of raising — so the caller's
        # `except` never fires, the crawl never returns, and the search sits in
        # `scraping` forever. A deadline converts that into an error somebody
        # can read.
        browser = await asyncio.wait_for(
            pw.chromium.launch(
                headless=True,
                args=[
                    # Chromium's sandbox needs kernel capabilities a container
                    # does not grant. Without these it exits during startup, or
                    # blocks waiting on a namespace it will never get.
                    "--no-sandbox",
                    "--disable-setuid-sandbox",
                    # /dev/shm is 64MB in most containers and Chromium will
                    # exhaust it on a heavy page, then die mid-render.
                    "--disable-dev-shm-usage",
                    # Nothing here is displayed, and both cost memory that a
                    # small instance does not have to spare.
                    "--disable-gpu",
                    "--single-process",
                ],
            ),
            timeout=settings.browser_launch_timeout_s,
        )
        try:
            yield browser
        finally:
            # Never allowed to hang the shutdown either: the browser may already
            # be wedged, and this runs on the way out of a failure.
            try:
                await asyncio.wait_for(browser.close(), timeout=15.0)
            except (TimeoutError, asyncio.TimeoutError):
                log.warning("crawler: browser did not close cleanly")


async def _settle(page) -> None: 
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
    except Exception:  
        pass


#: ``backend-py/`` — the first place a relative auth path is looked for.
_BACKEND_ROOT = Path(__file__).resolve().parents[2]

#: Hosts a saved session exists for. A session file is a credential, so it is
#: loaded only for the host it was captured on. Playwright scopes stored cookies
#: by origin anyway, which makes this belt and braces rather than the only
#: thing standing between one portal's cookies and another portal.
_AUTH_HOSTS = frozenset({"magicbricks.com", "www.magicbricks.com", "m.magicbricks.com"})

#: Words on the control that reveals a number.
#:
#: Matched as visible text rather than by class or id, deliberately: portals
#: rename their classes every few weeks and reword their buttons every few
#: years. ``mb-srp__action--btn`` will break; "View Contact" will not.
_REVEAL_LABEL = re.compile(
    r"(view|show|get|see)\s*(the\s*)?"
    r"(contact|phone|mobile|number|owner\s*detail|advertiser)"
    r"|contact\s*(owner|agent|builder|dealer|seller)",
    re.I,
)

#: Everything a portal might have made clickable. Real ``<button>`` elements are
#: the minority on these pages — most controls are styled ``div``s, which is why
#: ``get_by_role("button")`` alone finds almost nothing here.
_CLICKABLE = (
    "button, a, [role='button'], "
    "div[class*='btn'], span[class*='btn'], "
    "div[class*='action'], div[class*='contact']"
)

#: The card a control sits in, so a revealed number can be written back beside
#: the listing it belongs to.
_CARD_ANCESTOR = (
    "xpath=ancestor::*["
    "self::li or self::article"
    " or ("
    "(contains(@class,'card') or contains(@class,'srp') or contains(@class,'result'))"
    # Without these exclusions an action bar named `mb-srp__card__action`
    # satisfies contains(@class,'card') and is mistaken for the listing. The
    # wrapper then resolves its card as the <li> while the button inside it
    # resolves to the action bar, so the two never agree on which card they
    # belong to.
    " and not(contains(@class,'action'))"
    " and not(contains(@class,'btn'))"
    ")"
    "][1]"
)

#: Stamped on a card once its reveal has been attempted, so the wrapper and the
#: button nested inside it are not both clicked.
_HANDLED_ATTR = "data-khoj-revealed"

#: Whatever a portal calls the thing it opens over the page.
_OVERLAY = "[role='dialog'], [class*='modal'], [class*='popup'], [class*='overlay']"

#: A number that appeared where one was not before. Loose on purpose — this only
#: has to notice that digits arrived. Normalising to E.164 stays in
#: ``app.llm.extractor.to_e164`` so there is one definition of a dialable
#: number, not two that can disagree.
_PHONE = re.compile(r"(?:\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}")


def _session_is_signed_in(path: Path) -> tuple[bool, str]:
    """Whether a saved storage_state actually represents a logged-in user.

    Existence is not evidence of a login. An anonymous visit to MagicBricks
    already sets cookies -- measured 2026-09-06, a browser that had never signed
    in produced exactly three (``firstInteractionCookie``, ``cookieDtfirstIntr``
    and an anonymous ``HDSESSIONID``) and no local storage. Replaying that is
    indistinguishable from replaying nothing, except that the crawler believes
    it is authenticated, spends its click budget on reveals that cannot work,
    and reports the result as an ordinary gate.

    The sidecar written by ``scripts/generate_auth.py`` is authoritative when
    present, because that script is the only thing that ever saw the login
    happen. The shape check is a fallback for files captured before the sidecar
    existed.
    """
    meta = path.with_suffix(".meta.json")
    if meta.is_file():
        try:
            record = json.loads(meta.read_text(encoding="utf-8"))
            if record.get("login_confirmed") is True:
                return True, "login confirmed at capture"
            return False, "generate_auth.py could not confirm a login when this was saved"
        except Exception:  # noqa: BLE001 - a damaged sidecar falls through
            pass

    try:
        state = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:  # noqa: BLE001 - unreadable is not usable
        return False, f"could not be read ({exc})"

    cookies = state.get("cookies") or []
    origins = state.get("origins") or []
    if len(cookies) <= 3 and not origins:
        return False, (
            f"holds only {len(cookies)} cookie(s) and no local storage, which is "
            "what an anonymous visit looks like"
        )
    return True, f"{len(cookies)} cookie(s), {len(origins)} origin(s)"


def _auth_state_for(url: str) -> str | None:
    """Path to a saved signed-in session for this URL's host, or ``None``.

    Missing is not an error: the crawler reads anonymously and reports the
    contacts as gated, which is what it did before this existed.
    """
    host = (urlparse(url).hostname or "").lower()
    if host not in _AUTH_HOSTS:
        return None

    raw = settings.magicbricks_auth_file
    candidate = Path(raw)
    candidates = (
        [candidate]
        if candidate.is_absolute()
        else [_BACKEND_ROOT / raw, Path(__file__).resolve().parent / raw, Path.cwd() / raw]
    )

    for path in candidates:
        if not path.is_file():
            continue
        age_days = (time.time() - path.stat().st_mtime) / 86_400
        if age_days > settings.auth_state_max_age_days:
            # An expired session looks exactly like a portal that changed its
            # markup — both reveal nothing. Say which one this is.
            log.warning(
                "crawler: %s is %.0f days old. If numbers come back gated, "
                "re-run scripts/generate_auth.py",
                path.name,
                age_days,
            )
        signed_in, reason = _session_is_signed_in(path)
        if not signed_in:
            # Deliberately the same outcome as no file at all. Reporting a
            # not-logged-in session as authenticated is worse than reporting no
            # session: it sends you looking at selectors and portal markup for
            # a problem that is entirely on this side of the connection.
            log.warning(
                "crawler: %s is not a signed-in session - %s. Reading %s anonymously. "
                "Re-run scripts/generate_auth.py and complete the OTP login before it saves.",
                path.name,
                reason,
                host,
            )
            return None

        log.info("crawler: replaying saved session from %s (%s)", path.name, reason)
        return str(path)

    log.info(
        "crawler: no %s found - reading %s anonymously, contacts will be gated",
        settings.magicbricks_auth_file,
        host,
    )
    return None


async def _text_of(locator, timeout_ms: int = 1_500) -> str:  # type: ignore[no-untyped-def]
    """Visible text of a locator, or empty. Never raises."""
    try:
        return await locator.inner_text(timeout=timeout_ms)
    except Exception:  # noqa: BLE001 - a detached or hidden node has no text
        return ""


async def _overlay_numbers(page) -> set[str]:  # type: ignore[no-untyped-def]
    """Numbers in a currently visible overlay. Empty when nothing is open."""
    try:
        dialog = page.locator(_OVERLAY).first
        if not await dialog.is_visible(timeout=500):
            return set()
        return set(_PHONE.findall(await _text_of(dialog, 1_500)))
    except Exception:  # noqa: BLE001 - no overlay is the common case
        return set()


async def _numbers_visible(page, scope) -> set[str]:  # type: ignore[no-untyped-def]
    """Every number readable right now, in the card *and* in any open overlay.

    Including the overlay in the baseline is the whole correctness argument for
    this loop. A modal that ignored the last dismissal still holds the previous
    card's number, so a card-only baseline makes that stale number look newly
    revealed on the next click — and it gets written into the wrong card. The
    product then dials a real broker about a flat that is not his, from a
    number the page genuinely contained, so every downstream guard passes it.
    Caught exactly this way against a synthetic page where the modal refused to
    close.
    """
    found = set(_PHONE.findall(await _text_of(scope, 2_000)))
    return found | await _overlay_numbers(page)


async def _dismiss_overlay(page) -> None:  # type: ignore[no-untyped-def]
    """Close whatever the click opened, so it cannot swallow the next one."""
    try:
        await page.keyboard.press("Escape")
        if not await _overlay_numbers(page):
            return
        # Escape is ignored by plenty of hand-rolled modals. Try the control a
        # person would reach for.
        closer = page.locator(
            "[aria-label*='lose'], [class*='close'], [class*='Close'], button:has-text('×')"
        ).first
        if await closer.is_visible(timeout=500):
            await closer.click(timeout=1_500, no_wait_after=True)
        if not await _overlay_numbers(page):
            return

        # Last resort: empty the overlay. Its number has already been written
        # beside the card it belongs to, and left in place it becomes a number
        # floating loose at the end of the page text with no listing attached —
        # which the extractor may reasonably pin on whichever card happens to
        # be last. Clearing it removes the ambiguity without losing anything;
        # this is our own browser context, and the DOM here exists only to be
        # flattened into text a moment later.
        await page.locator(_OVERLAY).first.evaluate("el => { el.textContent = ''; }")
    except Exception:  # noqa: BLE001 - a stuck overlay is handled by the diff
        pass


async def _reveal_contacts(page) -> int:  # type: ignore[no-untyped-def]
    """Click the "View Contact" controls and write the numbers into their cards.

    Returns how many numbers were revealed.

    Stops at the first of three conditions: ``max_contact_reveals`` numbers
    unlocked, ``max_contact_attempts`` controls clicked, or
    ``max_contact_misses`` clicks in a row that produced nothing. The first is
    the portal's free-tier contact quota, which is metered on numbers unlocked.
    The other two are the account itself — a run that clicks thirty controls and
    unlocks none looks far more like a bot than one that unlocks three and
    leaves, and it is also the shape every expired session takes.

    The number is written back into the card's own DOM rather than collected
    into a side list, and that is the whole point of the design. ``sanitise``
    flattens the page to text and the extractor reads it as one document, so a
    number that arrives in a modal — or in a list appended at the end — has
    nothing tying it to a listing. The model then guesses, and a wrong guess
    here means CALL-E dials a real broker about a flat that is not his. Beside
    the card, the association survives flattening and the extractor's evidence
    guard passes on its own, because the number is genuinely in the page text.

    Every failure mode is a ``continue``: a control that has moved, a modal that
    never opened, a rate limit, a card whose ancestor cannot be resolved. One
    stubborn card must not cost the other eleven, and a page where nothing
    reveals is a gated page, not a crash.
    """
    try:
        controls = page.locator(_CLICKABLE).filter(has_text=_REVEAL_LABEL)
        total = await controls.count()
    except Exception as exc:  # noqa: BLE001 - no controls is a normal outcome
        log.debug("crawler: no reveal controls (%s)", exc)
        return 0

    if not total:
        return 0

    target = settings.max_contact_reveals
    attempt_cap = settings.max_contact_attempts
    log.info(
        "crawler: %d reveal control(s) found; unlocking at most %d, clicking at most %d",
        total,
        target,
        attempt_cap,
    )

    revealed = 0
    clicks = 0
    misses = 0

    for i in range(total):
        if revealed >= target:
            log.info(
                "crawler: contact reveal limit reached (%d). Skipping %d remaining "
                "button(s) to preserve account quota.",
                target,
                total - i,
            )
            break

        if clicks >= attempt_cap:
            log.info(
                "crawler: attempt limit reached (%d clicks, %d revealed). Skipping %d "
                "remaining button(s) to preserve account quota.",
                clicks,
                revealed,
                total - i,
            )
            break

        try:
            control = controls.nth(i)
            # A hidden control is skipped without spending a click, so a page
            # full of off-screen duplicates cannot exhaust the attempt budget
            # without a single number being unlocked.
            if not await control.is_visible(timeout=1_000):
                continue

            card = control.locator(_CARD_ANCESTOR).first
            has_card = await card.count() > 0
            scope = card if has_card else page.locator("body")

            # One button, two matches.
            #
            # Portals wrap the reveal control in an action bar, and
            # filter(has_text=...) matches any element whose *subtree* carries
            # the text — so the wrapper and the button inside it both come back.
            # Measured on nested markup: three real buttons produced six controls
            # and five clicks for three numbers. Each duplicate is a second
            # request against a listing already unlocked, which is exactly the
            # exposure the cap exists to prevent, and it scores as a miss because
            # the number it finds was already there. Stamping the card makes the
            # second match a no-op.
            # closest(), not a comparison of resolved cards: the wrapper and the
            # button do not necessarily agree on which ancestor is the listing,
            # so asking "am I inside anything already handled?" is the question
            # that actually dedupes them. The control is stamped as well as the
            # card, so this still works when no card ancestor resolves at all.
            if await control.evaluate(f"el => !!el.closest('[{_HANDLED_ATTR}]')"):
                continue
            await control.evaluate(f"el => el.setAttribute('{_HANDLED_ATTR}', '1')")
            if has_card:
                await card.evaluate(f"el => el.setAttribute('{_HANDLED_ATTR}', '1')")

            before = await _numbers_visible(page, scope)
            # A page-level baseline as well, for the case where the click
            # navigates: the detail page has to be diffed against what the whole
            # page held before, not against one card's numbers, or every other
            # card's number reads as newly revealed.
            before_page = set(_PHONE.findall(await _text_of(page.locator("body"), 2_500)))

            await control.scroll_into_view_if_needed(timeout=2_000)
            was_at = page.url
            clicks += 1
            # no_wait_after: the click often opens a modal rather than
            # navigating, and waiting for a navigation that never comes burns
            # the whole timeout on every single card.
            await control.click(timeout=settings.contact_reveal_timeout_ms, no_wait_after=True)
            await page.wait_for_timeout(settings.contact_reveal_delay_ms)

            # The card first, an overlay only as a fallback. A number rendered
            # into the card is unambiguously that card's; one read out of a
            # shared overlay is only this card's if it was not there a moment
            # ago, which is what the diff against `before` establishes.
            # A control that navigates instead of opening a modal leaves every
            # remaining locator pointing at a page that no longer exists, so the
            # rest of the loop would throw its way to the miss limit. Read the
            # number from wherever we landed, then go back.
            navigated = page.url != was_at
            if navigated:
                fresh = (
                    set(_PHONE.findall(await _text_of(page.locator("body"), 2_500)))
                    - before_page
                )
            else:
                fresh = set(_PHONE.findall(await _text_of(scope, 2_000))) - before
                if not fresh:
                    fresh = await _overlay_numbers(page) - before

            await _dismiss_overlay(page)

            if navigated:
                try:
                    await page.go_back(wait_until="domcontentloaded", timeout=15_000)
                    await page.wait_for_timeout(800)
                    # go_back rebuilds the DOM, which throws the stamp away and
                    # would let the wrapper duplicate navigate all over again.
                    if has_card and await card.count():
                        await card.evaluate(
                            f"el => el.setAttribute('{_HANDLED_ATTR}', '1')"
                        )
                except Exception:  # noqa: BLE001 - cannot get back, so stop cleanly
                    log.info(
                        "crawler: could not return from a detail page; stopping with "
                        "%d reveal(s)",
                        revealed + (1 if fresh else 0),
                    )
                    if fresh:
                        revealed += 1
                    break

            if not fresh:
                misses += 1
                if misses >= settings.max_contact_misses:
                    log.info(
                        "crawler: %d clicks in a row revealed nothing - the saved "
                        "session has most likely expired. Stopping rather than "
                        "clicking through the remaining %d button(s).",
                        misses,
                        total - i - 1,
                    )
                    break
                continue
            misses = 0

            # sorted() only to make the choice deterministic when a card
            # exposes two numbers; in practice there is one.
            number = sorted(fresh)[0].strip()
            if has_card:
                await card.evaluate(
                    "(el, tel) => el.insertAdjacentText('beforeend', ' Contact: ' + tel)",
                    number,
                )
            revealed += 1

        except Exception as exc:  # noqa: BLE001 - one card, not the page
            log.debug("crawler: reveal %d/%d did not open (%s)", i + 1, budget, exc)
            continue

    log.info(
        "crawler: revealed %d contact(s) of a %d limit, from %d click(s)",
        revealed,
        target,
        clicks,
    )
    return revealed


async def _read_page(browser: "Browser", site: TargetSite) -> PageResult:
    """Fetch and sanitise one page."""
    url = str(site.url)

    if _is_private(url):
        return PageResult(
            site=site,
            status=ListingSourceStatus.ERROR,
            note="That address is on a private network.",
        )

    auth_state = _auth_state_for(url)

    context = await browser.new_context(
        user_agent=settings.user_agent,
        viewport={"width": 1440, "height": 2200},
        locale="en-IN",
        java_script_enabled=True,
        # A session captured by scripts/generate_auth.py, when one exists for
        # this host. The context then spawns already signed in, which is what
        # puts a number on a card instead of a "View Contact" button.
        storage_state=auth_state,
    )
    page: Page = await context.new_page()

    # Images and fonts double the load time and carry nothing the extractor can
    # read.
    #
    # Stylesheets are usually dropped for the same reason, but not when there is
    # a session to replay: Playwright refuses to click an element it considers
    # invisible, and visibility is computed from layout. An unstyled page
    # collapses, controls end up zero-height, and every reveal times out on a
    # button that is plainly there in the HTML. Paying for the CSS is the cost
    # of being able to click.
    _blocked = {"image", "font", "media"} if auth_state else {"image", "font", "media", "stylesheet"}

    async def _skip_assets(route, request):  # type: ignore[no-untyped-def]
        if request.resource_type in _blocked:
            await route.abort()
        else:
            await route.continue_()

    await page.route("**/*", _skip_assets)

    try:
        response = await page.goto(
            url, wait_until="domcontentloaded", timeout=settings.scrape_timeout_ms
        )
        try:
            await page.wait_for_load_state("networkidle", timeout=6_000)
        except Exception: 
            await page.wait_for_timeout(2_000)

        await _settle(page)

        # Before page.content(), necessarily: the reveal writes the numbers into
        # the DOM, and the DOM is what gets sanitised and handed to the
        # extractor.
        revealed = await _reveal_contacts(page) if auth_state else 0

        html = await page.content()
        final_url = page.url
        http_status = response.status if response else 0

    except Exception as exc:  
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
            authenticated=bool(auth_state),
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
    # Numbers actually revealed outrank the gate markers. The words "View
    # Contact" still sit on every card past the per-page cap, so the markers
    # keep matching long after the page has stopped being gated in the way that
    # matters — which would report a page carrying twelve dialable numbers as
    # one carrying none.
    if revealed:
        gated = False

    if revealed:
        note = f"Read {len(text):,} characters and revealed {revealed} contact number(s)."
    elif gated and auth_state:
        # The distinction worth drawing: a session was replayed and the numbers
        # stayed hidden. Almost always an expired session rather than a changed
        # portal, and the fix is a re-run rather than a code change.
        note = (
            f"{site.name} still gated every number despite a saved session — it has "
            "most likely expired. Re-run scripts/generate_auth.py."
        )
    elif gated:
        note = (
            f"{site.name} keeps contact numbers behind a login, so listings may "
            "arrive without a number to dial. Capture a session with "
            "scripts/generate_auth.py to reveal them."
        )
    else:
        note = f"Read {len(text):,} characters."

    return PageResult(
        site=site,
        status=ListingSourceStatus.CONTACT_GATED if gated else ListingSourceStatus.OK,
        text=text,
        final_url=final_url,
        contact_gated=gated,
        authenticated=bool(auth_state),
        revealed_contacts=revealed,
        note=note,
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

    def all_failed(note: str) -> list[PageResult]:
        return [
            PageResult(site=site, status=ListingSourceStatus.ERROR, note=note)
            for site in sites
        ]

    async def read_one(browser, site: TargetSite) -> PageResult:  # type: ignore[no-untyped-def]
        async with gate:
            # Per site, so one portal that stops responding mid-read costs its
            # own results and nothing else. `goto` is already bounded, but the
            # scrolling and contact-reveal work that follows it was not, and
            # `gather` waits for its slowest member — one stalled site held the
            # whole search open.
            try:
                return await asyncio.wait_for(
                    _read_page(browser, site), timeout=settings.site_read_timeout_s
                )
            except (TimeoutError, asyncio.TimeoutError):
                log.warning(
                    "crawler: %s did not finish within %.0fs — skipped",
                    site.name,
                    settings.site_read_timeout_s,
                )
                return PageResult(
                    site=site,
                    status=ListingSourceStatus.ERROR,
                    note=(
                        f"{site.name} did not respond within "
                        f"{settings.site_read_timeout_s:.0f}s and was skipped."
                    ),
                )

    async def everything() -> list:
        # The whole browser lifecycle sits inside the deadline, not just the
        # page reads. Entering `async_playwright()` spawns a Node driver
        # subprocess, and on an image missing Chromium's shared libraries that
        # spawn can block rather than fail — which left the earlier timeout,
        # wrapped around the launch alone, with nothing to time out.
        async with browser_session() as browser:
            return await asyncio.gather(
                *(read_one(browser, s) for s in sites), return_exceptions=True
            )

    try:
        results = await asyncio.wait_for(everything(), timeout=settings.crawl_timeout_s)
    except (TimeoutError, asyncio.TimeoutError):
        log.error("crawler: the whole crawl exceeded %.0fs", settings.crawl_timeout_s)
        return all_failed("The page reader ran out of time on this server.")
    except Exception as exc:
        # Overwhelmingly this is a missing browser. `pip install playwright`
        # installs the client, not Chromium, so a build that never ran
        # `playwright install chromium --with-deps` reaches exactly here.
        log.exception("crawler: could not start a browser (%s)", exc.__class__.__name__)
        return all_failed(
            "The page reader could not start on this server — it needs Chromium "
            "and more memory than is available. Paste the listing text or a "
            "listing URL instead."
        )

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
