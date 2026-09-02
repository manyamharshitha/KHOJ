"""Customer-facing endpoints: start a search, read it back, trigger calls."""

from __future__ import annotations

import logging
from datetime import timedelta

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query, status

from app.config import settings
from app.core.auth import OptionalUser, read_quota, require_user
from app.core.plans import Quota, clip_to_plan, limit_for
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
    create_session,
    get_session,
    listings_for_session,
    new_id,
    reports_for_session,
    set_session_status,
)
from app.scraping.sites import SITES, resolve_targets

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

    ceiling = min(limit or settings.max_calls_per_session, quota.remaining)
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
