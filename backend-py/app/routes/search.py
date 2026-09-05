"""Customer-facing endpoints: start a search, read it back, trigger calls."""

from __future__ import annotations

import logging
from datetime import timedelta

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query, status

from app.config import settings
from app.core.auth import OptionalUser, read_quota, require_user
from app.core.plans import Quota, check_call_allowance, clip_to_plan
from app.llm.preferences import parse_preferences
from app.models import (
    PASTED_PLACEHOLDER_URL,
    PASTED_SOURCE,
    ListingResult,
    SearchRequest,
    SearchResponse,
    SearchSession,
    SessionResults,
    SessionStatus,
    TargetSite,
    as_utc,
    utcnow,
)
from app.pipeline import run_calls, run_search
from app.ranking import rank_listings
from app.repositories import (
    calls_for_session,
    count_calls_ever,
    count_calls_since,
    create_session,
    get_cached_locality,
    get_session,
    list_recent_sessions,
    list_sessions_for_customer,
    listings_for_session,
    new_id,
    reports_for_session,
    save_cached_locality,
    set_session_status,
)
from app.scraping.sites import SITES, resolve_targets
from app.services.scraper import locality_context

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["search"])

#: How long a session may sit in ``calling`` without an update before the lock
#: is considered abandoned and a retry is allowed through.
STALE_CALL_LOCK = timedelta(minutes=5)



@router.get("/sites")
async def list_sites() -> dict[str, list[dict[str, object]]]:
    """The portals we know about, and whether their contacts are reachable.

    Surfaced so the UI can warn *before* a search that a chosen portal keeps
    phone numbers behind a login, rather than after it returns nothing dialable.
    """
    return {
        "sites": [
            {
                "key": spec.key,
                "name": spec.name,
                "contact_gated": spec.contact_gated,
                "note": spec.note,
            }
            for spec in SITES.values()
        ]
    }


@router.post("/search", response_model=SearchResponse, status_code=status.HTTP_202_ACCEPTED)
async def start_search(
    body: SearchRequest, background: BackgroundTasks, user: OptionalUser = None
) -> SearchResponse:
    """Parse the customer's prompt and start the search in the background.

    Returns as soon as the session exists, because crawling five sites and
    reading them takes far longer than an HTTP request should. Progress is read
    back from ``GET /api/session/{id}``.
    """
    if len(body.sites) > settings.max_sites_per_search:
        raise HTTPException(
            status_code=400,
            detail=f"At most {settings.max_sites_per_search} sites per search.",
        )

    account = await require_user(user)
    tier, plan_limit, used = await read_quota(account.uid)
    quota = Quota(tier=tier, limit=plan_limit, used=used)
    if quota.exhausted:
        raise HTTPException(status_code=status.HTTP_402_PAYMENT_REQUIRED, detail=quota.message())

    criteria = await parse_preferences(body.prompt)

    # What the customer stated overrides what the model guessed — explicit beats
    # inferred. This also keeps a search working when preference parsing fails
    # outright: the prompt still shapes the questions, but the city that decides
    # which page is fetched no longer depends on a model call succeeding.
    if body.city:
        criteria.city = body.city.strip()
    if body.localities:
        stated = [x.strip() for x in body.localities if x.strip()]
        # Ahead of anything parsed, and de-duplicated case-insensitively so
        # "Kondapur" typed and "kondapur" inferred do not both survive.
        seen: set[str] = set()
        merged: list[str] = []
        for item in stated + list(criteria.localities):
            if item.lower() in seen:
                continue
            seen.add(item.lower())
            merged.append(item)
        criteria.localities = merged[:10]

    pasted = (body.pasted_content or "").strip() or None

    if pasted:
        # Pasted text is the path that works when a portal keeps its phone
        # numbers behind a login, so it takes priority over the site list and
        # nothing is crawled at all.
        #
        # ``target_sites`` still needs one entry because the session schema
        # requires it. This placeholder is never fetched; it exists so the
        # provenance of the results reads honestly in the UI.
        targets = [
            TargetSite(name=PASTED_SOURCE, url=PASTED_PLACEHOLDER_URL, contact_gated=False)
        ]
    else:
        targets = resolve_targets(body.sites, criteria, max_sites=settings.max_sites_per_search)

        if not targets:
            raise HTTPException(
                status_code=400,
                detail=(
                    "None of those sites could be resolved. Use a known key "
                    f"({', '.join(SITES)}) or a full https:// URL."
                ),
            )

    session = SearchSession(
        id=new_id("ses"),
        customer_id=account.uid if account.uid != "anonymous" else body.customer_id,
        prompt=body.prompt,
        criteria=criteria,
        target_sites=targets,
        pasted_content=pasted,
    )
    await create_session(session)

    background.add_task(run_search, session)
    if body.auto_call:
        background.add_task(_search_then_call, session)

    return SearchResponse(
        session_id=session.id,
        status=session.status,
        criteria=criteria,
        target_sites=targets,
        tier=tier.value,
        listings_limit=plan_limit,
    )


async def _search_then_call(session: SearchSession) -> None:
    """Wait for the search to finish, then start calling.

    Only used when the customer asked for it. Placing calls is not something to
    do on her behalf without being told to.
    """
    import asyncio

    for _ in range(120):
        await asyncio.sleep(2)
        current = await get_session(session.id)
        if current is None:
            return
        if current.status is SessionStatus.RANKED:
            await run_calls(session.id)
            return
        if current.status is SessionStatus.FAILED:
            return


@router.get("/sessions")
async def list_history(
    user: OptionalUser = None,
    limit: int = Query(default=25, ge=1, le=100),
) -> dict[str, object]:
    """Past searches, newest first — the history behind the results.

    Signed in, this is that customer's own searches. Signed out (or with
    ``AUTH_REQUIRED`` off) it is simply the most recent ones, because a session
    created anonymously carries no customer id and filtering by one would show
    an empty history for exactly the setup being demonstrated.

    A summary only. Listings, transcripts and honesty reports stay behind
    ``/api/session/{id}/results`` rather than being fanned out here, so opening
    a history page does not read every transcript ever recorded.
    """
    account = await require_user(user)
    if account.uid and account.uid != "anonymous":
        sessions = await list_sessions_for_customer(account.uid, limit=limit)
    else:
        sessions = await list_recent_sessions(limit=limit)

    return {
        "sessions": [
            {
                "session_id": x.id,
                "prompt": x.prompt,
                "status": x.status.value,
                "error": x.error,
                "listings_found": x.listings_found,
                "listings_matched": x.listings_matched,
                "calls_placed": x.calls_placed,
                "calls_completed": x.calls_completed,
                "created_at": x.created_at,
                "updated_at": x.updated_at,
                "results_url": f"/api/session/{x.id}/results",
            }
            for x in sessions
        ],
        "count": len(sessions),
    }


@router.get("/session/{session_id}")
async def read_session(session_id: str) -> dict[str, object]:
    """Status and the ranked listings so far."""
    session = await get_session(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="No such search.")

    listings = rank_listings(await listings_for_session(session_id))
    return {
        "session": session.model_dump(mode="json"),
        "listings": [
            {**x.model_dump(mode="json"), "total_monthly_cost": x.total_monthly_cost}
            for x in listings
        ],
    }


@router.get("/session/{session_id}/locality")
async def session_locality(
    session_id: str,
    refresh: bool = Query(default=False, description="Ignore the cache and re-fetch."),
) -> dict[str, object]:
    """What people who live in this area say about it.

    Context, not verification. The phone call establishes the flat; this is
    unverified opinion from public Reddit posts, and it is labelled that way in
    the response so the UI cannot present it with the same weight as a call.

    The locality comes from the session's own listings, so this needs no
    parameters the customer would have to type.
    """
    session = await get_session(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="No such search.")

    listings = await listings_for_session(session_id)
    locality = next((x.locality for x in listings if x.locality), None)
    locality = locality or (session.criteria.localities[0] if session.criteria.localities else None)
    city = session.criteria.city

    if not locality:
        return {
            "locality": None,
            "context": None,
            "note": "No locality could be identified for this search.",
        }

    if not refresh:
        cached = await get_cached_locality(locality, city)
        if cached:
            return {"locality": locality, "context": cached, "cached": True}

    context = (await locality_context(locality, city)).to_document()
    try:
        await save_cached_locality(locality, city, context)
    except Exception:  # noqa: BLE001 - a cache miss must not fail the request
        log.exception("locality: could not cache %s", locality)

    return {"locality": locality, "context": context, "cached": False}


@router.post("/session/{session_id}/call-all", status_code=status.HTTP_202_ACCEPTED)
async def call_all(
    session_id: str,
    background: BackgroundTasks,
    user: OptionalUser = None,
    limit: int = Query(default=0, ge=0, le=40),
) -> dict[str, object]:
    """Start calling the matched listings, cheapest first."""
    session = await get_session(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="No such search.")
    if session.status is SessionStatus.CALLING:
        # A crash between "mark calling" and "mark complete" would otherwise
        # wedge the session forever: every retry answers 409 and nothing can
        # move it back. The lock therefore expires — a call that has produced no
        # update in STALE_CALL_LOCK is treated as abandoned, not in progress.
        idle = utcnow() - as_utc(session.updated_at)
        if idle < STALE_CALL_LOCK:
            remaining = int((STALE_CALL_LOCK - idle).total_seconds())
            raise HTTPException(
                status_code=409,
                detail=(
                    "This search is already calling. If it is stuck, it unlocks "
                    f"in {remaining}s."
                ),
            )
        log.warning(
            "[%s] call lock was stale (idle %ds) — reclaiming it",
            session_id,
            int(idle.total_seconds()),
        )
        await set_session_status(session_id, SessionStatus.RANKED)

    listings = await listings_for_session(session_id)
    dialable = [x for x in listings if x.is_callable]
    if not dialable:
        raise HTTPException(
            status_code=409,
            detail=(
                "No listing has a phone number to dial. The portals keep contact "
                "details behind a login — paste a listing URL that shows a number."
            ),
        )

    account = await require_user(user)
    tier, plan_limit, used = await read_quota(account.uid)
    quota = Quota(tier=tier, limit=plan_limit, used=used)
    if quota.exhausted:
        raise HTTPException(status_code=status.HTTP_402_PAYMENT_REQUIRED, detail=quota.message())

    # Rate limits, checked before anything is dialled. 403 rather than 402: this
    # is not a "pay us" wall, it is a ceiling that applies whatever the plan,
    # and the frontend styles the two differently.
    allowance = check_call_allowance(
        tier=tier,
        calls_today=await count_calls_since(account.uid, utcnow() - timedelta(days=1)),
        calls_ever=await count_calls_ever(account.uid),
        daily_limit=settings.max_calls_per_day,
        free_lifetime_limit=settings.free_plan_lifetime_calls,
    )
    if not allowance.allowed:
        log.info("call-all refused for %s: %s", account.uid, allowance.reason)
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=allowance.message())

    # Never dial more than the daily allowance leaves, even if more were asked
    # for: a session with ten dialable listings must not spend ten calls.
    remaining_today = max(0, settings.max_calls_per_day - allowance.calls_today)
    ceiling = min(limit or settings.max_calls_per_session, quota.remaining, remaining_today)
    background.add_task(run_calls, session_id, ceiling)
    return {
        "session_id": session_id,
        "queued": min(len(dialable), ceiling),
        "tier": tier.value,
        "remaining_after": max(0, quota.remaining - min(len(dialable), ceiling)),
        "status": SessionStatus.CALLING.value,
    }


@router.get("/session/{session_id}/results", response_model=SessionResults)
async def read_results(session_id: str, user: OptionalUser = None) -> SessionResults:
    """Everything the customer came for.

    Ranked listings, each with the call that was made, exactly what was asked and
    answered, a link to the recording, and the honesty analysis.
    """
    session = await get_session(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="No such search.")

    account = await require_user(user)
    tier, plan_limit, used = await read_quota(account.uid)

    ranked = rank_listings(await listings_for_session(session_id))
    listings, beyond = clip_to_plan(ranked, tier)
    calls = {c.listing_id: c for c in await calls_for_session(session_id)}
    reports = {r.listing_id: r for r in await reports_for_session(session_id)}

    return SessionResults(
        session=session,
        tier=tier.value,
        listings_limit=plan_limit,
        beyond_plan=beyond,
        results=[
            ListingResult(
                listing=listing,
                total_monthly_cost=listing.total_monthly_cost,
                call=calls.get(listing.id),
                honesty=reports.get(listing.id),
            )
            for listing in listings
        ],
    )
