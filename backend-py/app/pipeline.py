"""The two long-running jobs: search, and call.

Both are started from a route and run in the background, reporting progress by
updating the session document. Neither ever raises into the request that started
it — a search that fails records why and leaves the customer with whatever it
managed to find.
"""

from __future__ import annotations

import asyncio
import logging
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
    new_id,
    save_call,
    save_listings,
    save_report,
    save_verification,
    set_session_status,
    update_session,
)
from app.scraping.crawler import crawl
from app.telephony.calle_dialer import CalleDialer, CalleUnavailable, spoken_int
from app.telephony.mock_dialer import MockDialer
from app.telephony.persona import build_task

log = logging.getLogger(__name__)

#: Guards against two calls to the same broker from one process.
_call_gate = asyncio.Semaphore(settings.max_concurrent_calls)


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


async def run_search(session: SearchSession) -> None:
    """Crawl every target site, extract listings, rank them, persist.

    Sites are processed independently: one portal blocking automated readers
    costs its own results and nothing else.
    """
    sid = session.id
    criteria_text = criteria_summary(session.criteria)
    log.info("[%s] search: %s", sid, criteria_text)

    try:
        listings: list[Listing] = []

        if session.pasted_content:
            # The customer supplied the text, so there is nothing to fetch. This
            # is the path that works when a portal gates its contact numbers,
            # and on a host where Chromium cannot start it is the only path that
            # works at all.
            log.info("[%s] using pasted content (%d chars), skipping the crawler",
                     sid, len(session.pasted_content))
            await set_session_status(sid, SessionStatus.EXTRACTING)

            try:
                listings = await extract_listings(
                    session_id=sid,
                    source_site=PASTED_SOURCE,
                    page_text=session.pasted_content,
                    page_url=None,
                    criteria=session.criteria,
                    criteria_text=criteria_text,
                    max_listings=settings.max_listings_per_site,
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
                await update_session(
                    sid,
                    status=SessionStatus.FAILED.value,
                    error="None of the chosen sites could be read. "
                    + " ".join(p.note for p in pages if p.note),
                )
                return

            await set_session_status(sid, SessionStatus.EXTRACTING)

            extracted = await asyncio.gather(
                *(
                    extract_listings(
                        session_id=sid,
                        source_site=page.site.name,
                        page_text=page.text,
                        page_url=page.final_url or str(page.site.url),
                        criteria=session.criteria,
                        criteria_text=criteria_text,
                        max_listings=settings.max_listings_per_site,
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
        await update_session(
            sid,
            status=SessionStatus.RANKED.value,
            listings_found=len(listings),
            listings_matched=len(within_plan),
            error=None
            if callable_count
            else "Listings were found, but none carried a phone number — the portals keep "
            "contact details behind a login. Paste a listing URL that shows a number.",
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


async def run_calls(session_id: str, limit: int | None = None) -> None:
    """Phone the ranked listings, cheapest first.

    Bounded by ``max_concurrent_calls``: the cap exists so a run does not ring
    forty phones at once, and so a free-tier quota is not spent in one burst.
    """
    session = await get_session(session_id)
    if session is None:
        return

    if not inside_calling_window():
        await update_session(
            session_id,
            status=SessionStatus.RANKED.value,
            error="Outside calling hours (11:00-13:00 and 17:00-20:00 IST). Nothing was dialled.",
        )
        return

    # Read the plan again here rather than trusting the number from ranking: a
    # tier can change, or another session can consume the quota, while a long
    # search is still running.
    uid = session.customer_id or "anonymous"
    tier, plan_limit, used = await read_quota(uid)
    quota = Quota(tier=tier, limit=plan_limit, used=used)

    if quota.exhausted:
        await update_session(
            session_id, status=SessionStatus.COMPLETE.value, error=quota.message()
        )
        log.info("[%s] quota exhausted on %s, nothing dialled", session_id, tier)
        return

    listings = await listings_for_session(session_id)
    ceiling = min(limit or settings.max_calls_per_session, quota.remaining)
    targets = call_order(listings, ceiling)

    if not targets:
        await update_session(
            session_id,
            status=SessionStatus.COMPLETE.value,
            error="No listing had a phone number to dial.",
        )
        return

    await set_session_status(session_id, SessionStatus.CALLING)
    log.info("[%s] calling %d listing(s)", session_id, len(targets))

    await asyncio.gather(*(_call_one(session, x) for x in targets), return_exceptions=True)

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


async def _call_one(session: SearchSession, listing: Listing) -> None:
    """Verify one listing by phone, then analyse what was said."""
    phone = listing.contact_number
    if not phone:
        return

    async with _call_gate:
        call = CallLog(
            id=new_id("cal"),
            session_id=session.id,
            listing_id=listing.id,
            phone_dialed=phone,
        )

        if settings.bypass_call_window:
            # Logged at warning level deliberately. Silently ignoring the
            # cooldown is how a test configuration reaches production and starts
            # ringing the same broker every hour.
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
            log.info(
                "[%s] skipped %s — called within the last %d days. "
                "Set BYPASS_CALL_WINDOW=true to dial it again while testing.",
                session.id,
                phone,
                settings.number_cooldown_days,
            )
            return

        await create_call(call)
        await mark_listing_called(listing.id)

        try:
            dialer = build_dialer()
        except CalleUnavailable as exc:
            call.call_status = CallStatus.FAILED
            call.error = str(exc)[:400]
            await save_call(call)
            log.error("[%s] telephony unavailable: %s", session.id, exc)
            return

        call.call_status = CallStatus.DIALING
        call.started_at = utcnow()
        await save_call(call)

        task = build_task(listing, session.criteria, criteria_summary(session.criteria))
        outcome = await dialer.verify(
            call_id=call.id, listing=listing, criteria=session.criteria, task=task
        )

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
