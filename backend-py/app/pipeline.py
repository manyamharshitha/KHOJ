"""The two long-running jobs: search, and call.

Both are started from a route and run in the background, reporting progress by
updating the session document. Neither ever raises into the request that started
it — a search that fails records why and leaves the customer with whatever it
managed to find.
"""

from __future__ import annotations

import asyncio
import logging
from contextlib import suppress
from datetime import datetime, timedelta, timezone

from app.config import settings
from app.core.auth import consume_quota, read_quota
from app.core.plans import Quota, clip_to_plan
from app.llm.extractor import extract_listings
from app.llm.honesty import evaluate_call
from app.llm.preferences import criteria_summary
from app.models import (
    PASTED_SOURCE,
    CallLog,
    CallStatus,
    Listing,
    ListingSourceStatus,
    SearchSession,
    SessionStatus,
    Speaker,
    Verification,
    utcnow,
)
from app.ranking import call_order, filter_hard_constraints, rank_listings
from app.repositories import (
    called_recently,
    create_call,
    get_session,
    listings_for_session,
    mark_listing_called,
    native_listings,
    new_id,
    save_call,
    save_listings,
    save_report,
    save_verification,
    set_session_status,
    update_session,
)
from app.scraping.capacity import headless_available
from app.scraping.crawler import crawl
from app.telephony.calle_dialer import CalleDialer, CalleUnavailable, spoken_int
from app.telephony.mock_dialer import MockDialer
from app.telephony.persona import build_task

log = logging.getLogger(__name__)

#: Guards against two calls to the same broker from one process.
_call_gate = asyncio.Semaphore(settings.max_concurrent_calls)

#: Outcomes worth dialling again.
#:
#: FAILED only, and deliberately not the rest. A FAILED call is one the network
#: refused before it reached anybody — nothing rang, so nobody is disturbed by
#: trying again. NO_ANSWER, BUSY and CANCELLED all mean a real telephone rang
#: in someone's hand; repeating those would ring a stranger a second time
#: because our provider was unreliable, and that cost lands on them rather than
#: on us.
_WORTH_RETRYING = frozenset({CallStatus.FAILED})


def ist_minutes(at: datetime) -> int:
    """Minutes past midnight, IST. India has no daylight saving, so a fixed
    offset is exactly right and costs no dependency."""
    ist = at.astimezone(timezone.utc) + timedelta(hours=5, minutes=30)
    return ist.hour * 60 + ist.minute


def inside_calling_window(at: datetime | None = None) -> bool:
    """Whether it is currently a decent hour to phone a stranger."""
    if settings.ignore_call_window or settings.bypass_call_window:
        return True
    minute = ist_minutes(at or utcnow())
    return any(start <= minute < end for start, end in settings.windows_ist)


# --------------------------------------------------------------------------
# search
# --------------------------------------------------------------------------


async def _native_for(session: SearchSession) -> list[Listing]:
    """Properties listed on Khoj that belong in this search's results.

    Copied into the searching session rather than referenced. A listing in this
    schema belongs to the session that found it — that is what lets ranking,
    calling, the quota and the honesty report all key off ``session_id`` without
    knowing where a listing came from. Handing back a row owned by somebody
    else's session would put a foreign key through all of them.

    The copy keeps the owner's identity and the original id, so a native result
    can still be traced back to the property it was taken from. It does not keep
    ``called``: whether the owner's own listing has been rung before has nothing
    to do with this customer's search.
    """
    try:
        found = await native_listings(session.criteria, limit=settings.max_listings_per_site)
    except Exception:  # noqa: BLE001 - native results must not sink a crawl
        log.exception("[%s] could not read Khoj listings", session.id)
        return []

    copies: list[Listing] = []
    for source in found:
        # A broker's own search must not return the broker their own flat.
        if session.customer_id and source.owner_id == session.customer_id:
            continue
        copy = source.model_copy(
            update={
                "id": new_id("lst"),
                "session_id": session.id,
                "called": False,
                "created_at": utcnow(),
                "ai_match_reason": "Listed directly on Khoj by the owner or their agent.",
            }
        )
        copies.append(copy)

    log.info("[%s] %d Khoj listing(s) merged into the results", session.id, len(copies))
    return copies


async def run_search(session: SearchSession) -> None:
    """Crawl every target site, extract listings, rank them, persist.

    Sites are processed independently: one portal blocking automated readers
    costs its own results and nothing else.

    Wrapped in a deadline, and in a guard that guarantees a terminal status.
    This runs as a background task with nobody waiting on it, so a coroutine
    that never returns is invisible from the outside — the session simply stays
    in ``scraping``, which the customer reads as "still working" indefinitely.
    A search that failed must say so.
    """
    try:
        await asyncio.wait_for(_run_search(session), timeout=settings.search_timeout_s)
    except (TimeoutError, asyncio.TimeoutError):
        log.error(
            "[%s] search exceeded %.0fs and was abandoned",
            session.id,
            settings.search_timeout_s,
        )
        await update_session(
            session.id,
            status=SessionStatus.FAILED.value,
            error=(
                "That search took too long and was stopped. The portals may be "
                "slow or unreachable right now — try fewer sources, or paste a "
                "listing URL instead."
            ),
        )
    except asyncio.CancelledError:
        # The worker is going away mid-search — a deploy, a restart, a shutdown.
        # Record it before the task dies, then let the cancellation continue;
        # swallowing it would lie to the event loop about having stopped.
        log.warning("[%s] search cancelled before it finished", session.id)
        await update_session(
            session.id,
            status=SessionStatus.FAILED.value,
            error="That search was interrupted by a server restart. Please run it again.",
        )
        raise
    except BaseException as exc:
        # Deliberately wider than Exception. A background task that dies takes
        # its traceback with it — nothing is awaiting this coroutine, so an
        # exception here is reported nowhere and the session is left mid-flight.
        # MemoryError and KeyboardInterrupt are not Exceptions and are exactly
        # what a browser on a small instance produces.
        #
        # The class name is logged explicitly because that is the part that
        # identifies the failure: "MemoryError" and "TargetClosedError" say
        # completely different things about what to fix, and str(exc) is empty
        # for several of them.
        log.exception("[%s] search died: %s", session.id, exc.__class__.__name__)
        with suppress(Exception):
            await update_session(
                session.id,
                status=SessionStatus.FAILED.value,
                error=f"That search stopped unexpectedly ({exc.__class__.__name__}).",
            )
        raise


async def _run_search(session: SearchSession) -> None:
    """The search itself. See :func:`run_search` for the deadline around it."""
    sid = session.id
    criteria_text = criteria_summary(session.criteria)
    log.info("[%s] search: %s", sid, criteria_text)

    try:
        listings: list[Listing] = []
        #: Why the portals were not read, when they were not. Carried to the end
        #: so the customer is told the difference between "the portals had
        #: nothing" and "this server could not open them".
        crawl_skipped: str | None = None

        if session.pasted_content:
            # The customer supplied the text, so there is nothing to fetch. This
            # is the path that works when a portal gates its contact numbers,
            # and on a host where Chromium cannot start it is the only path that
            # works at all.
            log.info("[%s] using pasted content (%d chars), skipping the crawler",
                     sid, len(session.pasted_content))
            await set_session_status(sid, SessionStatus.EXTRACTING)

            try:
                listings = await asyncio.wait_for(
                    extract_listings(
                        session_id=sid,
                        source_site=PASTED_SOURCE,
                        page_text=session.pasted_content,
                        page_url=None,
                        criteria=session.criteria,
                        criteria_text=criteria_text,
                        max_listings=settings.max_listings_per_site,
                    ),
                    timeout=settings.extraction_timeout_s,
                )
            except Exception:
                log.exception("[%s] extraction failed for pasted content", sid)
                await update_session(
                    sid,
                    status=SessionStatus.FAILED.value,
                    error="That pasted text could not be read as a listing. "
                    "Check it includes a rent and a contact number.",
                )
                return

            if not listings:
                await update_session(
                    sid,
                    status=SessionStatus.FAILED.value,
                    error="No listing could be found in the pasted text. Include the "
                    "rent, the locality and a contact number.",
                )
                return
        elif not (capacity := headless_available())[0]:
            # Asked before the browser starts, because afterwards is too late.
            #
            # Chromium wants ~400MB at launch. On an instance that does not have
            # it the kernel answers SIGKILL, which no `except` can catch — the
            # process vanishes mid-request and every other customer's call and
            # search goes with it. Declining to start the browser costs this one
            # search its portal results. Starting it costs the whole service.
            log.warning("[%s] headless crawling skipped — %s", sid, capacity[1])
            crawl_skipped = capacity[1]

        else:
            await set_session_status(sid, SessionStatus.SCRAPING)
            pages = await crawl(session.target_sites)

            ok = (ListingSourceStatus.OK, ListingSourceStatus.CONTACT_GATED)
            readable = [p for p in pages if p.status in ok]
            for page in pages:
                if page.status not in ok:
                    log.warning(
                        "[%s] %s: %s — %s", sid, page.site.name, page.status.value, page.note
                    )

            if not readable:
                # Not fatal when Khoj's own listings were also asked for: those
                # are fetched below and are a real result. Failing the whole
                # search because a portal blocked us would throw away listings
                # that were never going to come from that portal anyway.
                if not session.include_native:
                    await update_session(
                        sid,
                        status=SessionStatus.FAILED.value,
                        error="None of the chosen sites could be read. "
                        + " ".join(p.note for p in pages if p.note),
                    )
                    return
                log.warning("[%s] no portal was readable; using Khoj listings only", sid)

            await set_session_status(sid, SessionStatus.EXTRACTING)

            # Bounded per page. `gather` waits for its slowest member, so one
            # model call left open by a rate-limited provider held the whole
            # extraction — and with it the session — open indefinitely. A page
            # that times out is reported below like any other failure and the
            # rest of the search keeps its results.
            extracted = await asyncio.gather(
                *(
                    asyncio.wait_for(
                        extract_listings(
                            session_id=sid,
                            source_site=page.site.name,
                            page_text=page.text,
                            page_url=page.final_url or str(page.site.url),
                            criteria=session.criteria,
                            criteria_text=criteria_text,
                            max_listings=settings.max_listings_per_site,
                        ),
                        timeout=settings.extraction_timeout_s,
                    )
                    for page in readable
                ),
                return_exceptions=True,
            )

            for page, result in zip(readable, extracted, strict=True):
                if isinstance(result, BaseException):
                    log.exception(
                        "[%s] extraction failed for %s", sid, page.site.name, exc_info=result
                    )
                    continue
                listings.extend(result)

        # `or crawl_skipped`: when the portals could not be opened, Khoj's own
        # listings are searched whether or not they were asked for. They are the
        # only source left, they cost one indexed query, and returning nothing
        # at all when there is something to return would be the wrong answer to
        # a memory limit the customer neither caused nor can see.
        if session.include_native or crawl_skipped:
            listings.extend(await _native_for(session))

        kept, dropped = filter_hard_constraints(listings, session.criteria)
        for listing, reason in dropped:
            listing.ai_match_reason = f"Excluded: {reason}"

        ordered = rank_listings(kept)

        # Clip AFTER ranking, never before: clipping an unsorted list would
        # throw away the cheapest properties, which is the opposite of what the
        # customer is paying for.
        tier, limit, used = await read_quota(session.customer_id or "anonymous")
        within_plan, beyond = clip_to_plan(ordered, tier, used)
        if beyond:
            log.info("[%s] %d listing(s) beyond the %s plan ceiling", sid, beyond, tier)

        await save_listings(ordered + [x for x, _ in dropped])

        callable_count = sum(1 for x in within_plan if x.is_callable)

        # Informational, never FAILED. Whatever happened above, the ranked
        # listings are real and on screen, and a status of FAILED would hide
        # them behind an error card.
        if crawl_skipped and not listings:
            note = (
                "This server does not have the memory to open listing portals, so "
                "only properties listed directly on Khoj were searched — and none "
                "matched. Add a listing by hand, or paste a listing URL."
            )
        elif crawl_skipped:
            note = (
                "Showing properties listed directly on Khoj. The listing portals "
                "were not searched: this server does not have the memory to open "
                "them. Paste a listing URL, or add a number by hand, to include one."
            )
        elif not callable_count:
            note = (
                "These listings are shown, but none published a phone number — "
                "most portals keep it behind a login. Khoj can't call these for you. "
                "Paste a listing URL that shows a number, or add one by hand."
            )
        else:
            note = None

        await update_session(
            sid,
            status=SessionStatus.RANKED.value,
            listings_found=len(listings),
            listings_matched=len(within_plan),
            error=note,
        )
        log.info(
            "[%s] search done: %d found, %d matched, %d callable",
            sid,
            len(listings),
            len(ordered),
            callable_count,
        )

    except Exception as exc:  # noqa: BLE001 - a background job must not die silently
        log.exception("[%s] search failed", sid)
        await update_session(sid, status=SessionStatus.FAILED.value, error=str(exc)[:500])


# --------------------------------------------------------------------------
# calling
# --------------------------------------------------------------------------


async def reserve_calls(
    session: SearchSession, limit: int | None = None, listing_id: str | None = None
) -> list[tuple[Listing, CallLog]]:
    """Create the call rows for a session *before* any dialling starts.

    This exists to close a race, not to save a round trip. Creating the CallLog
    inside the background task meant the row did not exist yet when the browser
    fetched ``/results`` a moment after the 202 — the listing came back with
    ``call: null``, which the UI could not tell apart from a queued call, so a
    call that was actually ringing rendered as "scheduled" and stayed that way.

    Reserving synchronously means the row is on disk before the request returns:
    whatever the browser reads next, it reads a real status.
    """
    listings = await listings_for_session(session.id)
    # One named listing, when the customer picked one.
    #
    # Without this the endpoint always dialled whatever `call_order` ranked
    # first, so pressing "call" on the third result telephoned the first — and
    # the confirmation dialog had already named the third by address and number.
    # Agreeing to call one property and having a different one rung is not a
    # cosmetic bug when the thing on the other end is somebody's phone.
    if listing_id is not None:
        listings = [x for x in listings if x.id == listing_id]

    ceiling = limit or settings.max_calls_per_session
    reserved: list[tuple[Listing, CallLog]] = []

    for listing in call_order(listings, ceiling):
        phone = listing.contact_number
        if not phone:
            continue

        call = CallLog(
            id=new_id("cal"),
            session_id=session.id,
            customer_id=session.customer_id,
            listing_id=listing.id,
            phone_dialed=phone,
            call_status=CallStatus.DIALING,
            started_at=utcnow(),
        )

        # The cooldown is decided here rather than at dial time so that a number
        # which will never be rung is never shown as ringing.
        if settings.bypass_call_window:
            log.warning(
                "[%s] BYPASS_CALL_WINDOW is on — window and %d-day cooldown skipped for %s",
                session.id,
                settings.number_cooldown_days,
                phone,
            )
        elif await called_recently(phone, settings.number_cooldown_days):
            call.call_status = CallStatus.BLOCKED
            call.error = f"Already called within {settings.number_cooldown_days} days"

        await create_call(call)
        reserved.append((listing, call))

    return reserved


async def abandon_reserved(
    reserved: list[tuple[Listing, CallLog]] | None, reason: str
) -> None:
    """Close out rows that were reserved but will never be dialled.

    Every early return below happens *after* the endpoint has already written
    DIALING rows. Returning without touching them stranded the call on screen
    as "Calling now" forever — the customer watched a phone that was never going
    to ring. A reservation that is not going to be honoured has to say so.
    """
    for _, call in reserved or []:
        if call.call_status is CallStatus.BLOCKED:
            continue  # already terminal, and its own reason is more specific
        call.call_status = CallStatus.FAILED
        call.error = reason[:400]
        call.ended_at = utcnow()
        await save_call(call)


async def run_calls(
    session_id: str,
    limit: int | None = None,
    reserved: list[tuple[Listing, CallLog]] | None = None,
) -> None:
    """Phone the ranked listings, cheapest first.

    Bounded by ``max_concurrent_calls``: the cap exists so a run does not ring
    forty phones at once, and so a free-tier quota is not spent in one burst.

    ``reserved`` carries rows already created by :func:`reserve_calls`. When it
    is None this reserves its own — the auto-call path calls straight in here
    with no HTTP request in front of it to have done the work.
    """
    session = await get_session(session_id)
    if session is None:
        await abandon_reserved(reserved, f"Search {session_id} no longer exists.")
        return

    if not inside_calling_window():
        reason = (
            "Outside calling hours (11:00-13:00 and 17:00-20:00 IST). Nothing was dialled. "
            "Set BYPASS_CALL_WINDOW=true to dial outside these hours while testing."
        )
        await abandon_reserved(reserved, reason)
        await update_session(
            session_id, status=SessionStatus.RANKED.value, error=reason
        )
        log.warning("[%s] outside the calling window — nothing dialled", session_id)
        return

    # Read the plan again here rather than trusting the number from ranking: a
    # tier can change, or another session can consume the quota, while a long
    # search is still running.
    uid = session.customer_id or "anonymous"
    tier, plan_limit, used = await read_quota(uid)
    quota = Quota(tier=tier, limit=plan_limit, used=used)

    if quota.exhausted:
        await abandon_reserved(reserved, quota.message())
        await update_session(
            session_id, status=SessionStatus.COMPLETE.value, error=quota.message()
        )
        log.info("[%s] quota exhausted on %s, nothing dialled", session_id, tier)
        return

    ceiling = min(limit or settings.max_calls_per_session, quota.remaining)
    if reserved is None:
        reserved = await reserve_calls(session, ceiling)

    if not reserved:
        await update_session(
            session_id,
            status=SessionStatus.COMPLETE.value,
            error="No listing had a phone number to dial.",
        )
        return

    await set_session_status(session_id, SessionStatus.CALLING)
    log.info("[%s] calling %d listing(s)", session_id, len(reserved))

    # `return_exceptions=True` collects failures instead of raising them, so
    # anything _call_one throws lands here as a value and is otherwise dropped
    # on the floor — the row stays DIALING and the customer is told a call is
    # ringing that already crashed. Each result is inspected and written down.
    results = await asyncio.gather(
        *(_call_one(session, listing, call) for listing, call in reserved),
        return_exceptions=True,
    )
    for (_, call), result in zip(reserved, results, strict=True):
        if not isinstance(result, BaseException):
            continue
        log.exception(
            "[%s] call %s crashed while dialling %s",
            session_id,
            call.id,
            call.phone_dialed,
            exc_info=result,
        )
        call.call_status = CallStatus.FAILED
        call.error = f"{type(result).__name__}: {result}"[:400]
        call.ended_at = utcnow()
        await save_call(call)

    session = await get_session(session_id)
    await update_session(
        session_id,
        status=SessionStatus.COMPLETE.value,
        calls_completed=session.calls_completed if session else 0,
    )
    log.info("[%s] calling finished", session_id)


def build_dialer():  # type: ignore[no-untyped-def]
    """The configured telephony provider.

    CALL-E is the only real one. The mock exists so the whole pipeline runs
    without an account, and it returns the same ``CallOutcome`` shape.
    """
    if settings.telephony_provider == "calle":
        return CalleDialer()

    # TELEPHONY_PROVIDER defaults to "mock", so forgetting to set it on a
    # deployed host is silent: the mock returns a fabricated transcript and a
    # COMPLETED status without touching the telephone network. Nobody's phone
    # rings and the dashboard shows a finished verification. That is the single
    # most misleading state this system can reach, so it is said out loud on
    # every call rather than once at startup.
    log.warning(
        "TELEPHONY_PROVIDER=%s — using the MOCK dialer. No real call is placed and the "
        "transcript is fabricated. Set TELEPHONY_PROVIDER=calle with CALLE_API_KEY to "
        "dial for real.",
        settings.telephony_provider,
    )
    return MockDialer()


async def _write_verification(
    call: CallLog,
    listing: Listing,
    report: object | None,
    outcome: object | None,
) -> None:
    """Persist the customer-facing record of one verification.

    Keyed ``{session_id}:{listing_id}`` in the ``verifications`` collection.
    Firestore held these in a subcollection under the session; Mongo has no
    subcollections, so the parent is folded into the key — which keeps the same
    one-record-per-listing-per-search guarantee.

    Written even for a call that never connected. "We rang and nobody answered"
    is a real result the customer paid for; leaving a silent gap would look like
    the listing was simply skipped.
    """
    structured = getattr(outcome, "structured", {}) or {}
    spoken_rent = spoken_int(structured.get("rent_actual"))
    spoken_maintenance = spoken_int(structured.get("maintenance_actual"))
    spoken_total = (
        spoken_rent + (spoken_maintenance or 0) if spoken_rent is not None else None
    )

    record = Verification(
        listing_id=listing.id,
        call_id=call.id,
        listing_title=listing.title or listing.locality,
        phone_dialed=call.phone_dialed,
        call_status=call.call_status.value,
        advertised_total=listing.total_monthly_cost,
        spoken_rent=spoken_rent,
        spoken_maintenance=spoken_maintenance,
        spoken_total=spoken_total,
        qna_pairs=call.qna_pairs,
        transcript=call.transcript,
        audio_url=call.audio_url,
        honesty_score=getattr(report, "honesty_score", None),
        final_verdict=getattr(getattr(report, "final_verdict", None), "value", None),
        red_flags=list(getattr(report, "red_flags", []) or []),
        summary=getattr(report, "summary", None) or getattr(outcome, "summary", None),
    )

    try:
        await save_verification(call.session_id, record)
    except Exception:  # noqa: BLE001 - the call log is already saved; this is extra
        log.exception("[%s] could not write verification record", call.id)


async def _call_one(session: SearchSession, listing: Listing, call: CallLog) -> None:
    """Verify one listing by phone, then analyse what was said.

    ``call`` is already persisted by :func:`reserve_calls`. This dials it and
    records what happened; it never creates the row itself, so there is no
    window in which a listing is being called but has no call to show for it.
    """
    if call.call_status is CallStatus.BLOCKED:
        log.info(
            "[%s] skipped %s — called within the last %d days. "
            "Set BYPASS_CALL_WINDOW=true to dial it again while testing.",
            session.id,
            call.phone_dialed,
            settings.number_cooldown_days,
        )
        return

    async with _call_gate:
        await mark_listing_called(listing.id)

        try:
            dialer = build_dialer()
        except CalleUnavailable as exc:
            call.call_status = CallStatus.FAILED
            call.error = str(exc)[:400]
            await save_call(call)
            log.error("[%s] telephony unavailable: %s", session.id, exc)
            return

        task = build_task(listing, session.criteria, criteria_summary(session.criteria))

        # Retried, because this provider is demonstrably intermittent: the same
        # number, with a byte-identical payload, completed a call and then got
        # "no route" twenty-five minutes later. A carrier that cannot find a
        # route this second frequently can the next.
        #
        # Only for failures where nothing rang. Retrying a busy line or an
        # unanswered ring would telephone a real person a second time because
        # our provider was flaky, which is not a trade this product gets to
        # make on their behalf. `attempt` feeds the idempotency key, so a retry
        # is a genuinely new call rather than a replayed one.
        outcome = None
        for attempt in range(1, settings.call_attempts + 1):
            outcome = await dialer.verify(
                call_id=call.id,
                listing=listing,
                criteria=session.criteria,
                task=task,
                attempt=attempt,
            )
            if outcome.status not in _WORTH_RETRYING:
                break
            if attempt < settings.call_attempts:
                log.warning(
                    "[%s] attempt %d/%d did not reach the handset (%s) — retrying in %.0fs",
                    call.id,
                    attempt,
                    settings.call_attempts,
                    outcome.error or outcome.status.value,
                    settings.call_retry_delay_s,
                )
                call.attempt = attempt + 1
                await asyncio.sleep(settings.call_retry_delay_s)

        call.provider_call_id = outcome.provider_call_id or None
        call.call_status = outcome.status
        call.transcript = outcome.transcript
        call.qna_pairs = outcome.qna
        call.duration_sec = outcome.duration_sec
        call.consent_to_record = outcome.consent_to_record
        call.audio_url = outcome.recording_url
        call.error = outcome.error
        call.ended_at = utcnow()

        # A verification only counts against the plan when a call actually
        # happened. Charging for a number that rang out would be charging for
        # nothing.
        if outcome.status is CallStatus.COMPLETED:
            await consume_quota(session.customer_id or "anonymous", 1)

        await finish_call(call, outcome=outcome, listing=listing, session=session)


async def finish_call(
    call: CallLog,
    *,
    outcome: object | None = None,
    listing: Listing | None = None,
    session: SearchSession | None = None,
) -> None:
    """Everything that happens once a call ends.

    Shared by every dialer, so the mock and the live path store the same things
    in the same order and cannot drift apart.
    """
    if session is None:
        session = await get_session(call.session_id)
    if session is None:
        await save_call(call)
        return

    if listing is None:
        from app.repositories import get_listing

        listing = await get_listing(call.listing_id)
    if listing is None:
        await save_call(call)
        return

    if call.call_status is not CallStatus.COMPLETED or not call.transcript:
        await save_call(call)
        await _write_verification(call, listing, None, None)
        return

    try:
        report, qna = await evaluate_call(
            listing=listing, call=call, criteria=session.criteria, session_id=call.session_id
        )
        # The evaluator's Q&A carries verified quotes; the provider's does not.
        if qna:
            call.qna_pairs = qna
        await save_call(call)
        await save_report(report)
        await _write_verification(call, listing, report, outcome)
    except Exception:  # noqa: BLE001 - a failed analysis must not lose the transcript
        log.exception("[%s] analysis failed", call.id)
        await save_call(call)
        await _write_verification(call, listing, None, outcome)

    await update_session(
        call.session_id, calls_completed=(session.calls_completed or 0) + 1
    )


def owner_said(call: CallLog) -> str:
    """Everything the person on the other end said, for quick inspection."""
    return " ".join(t.text for t in call.transcript if t.speaker is Speaker.OWNER)
