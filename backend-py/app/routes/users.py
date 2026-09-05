"""User profiles: capture who signed in, and what they prefer.

The identity itself is never trusted from the request body. A signed-in caller's
uid comes from their verified Firebase token, and the body's ``user_id`` is only
honoured when it matches — otherwise anyone could write to anyone's profile by
posting a different id. With ``AUTH_REQUIRED`` off (the demo and local setups),
the body id is accepted, because there is no token to check it against and the
alternative is a profile feature that does nothing.
"""

from __future__ import annotations

import logging
from datetime import datetime

from fastapi import APIRouter, HTTPException, status
from pydantic import Field

from app.core.auth import OptionalUser, require_user
from app.core.plans import Quota, limit_for, normalise_tier
from app.models import Base, CallStatus
from app.repositories import (
    calls_for_sessions,
    get_user,
    list_recent_sessions,
    list_sessions_for_customer,
    listings_by_ids,
    read_quota_doc,
    upsert_user,
)

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/users", tags=["users"])


class ProfileRequest(Base):
    """``POST /api/users/profile`` body."""

    user_id: str = Field(min_length=1, max_length=128)
    name: str | None = Field(default=None, max_length=120)
    email: str | None = Field(default=None, max_length=320)
    preferred_localities: list[str] | None = Field(default=None, max_length=20)
    default_tenant_profile: str | None = Field(default=None, max_length=40)
    #: Full URLs of listing sites the customer added. Omitted means "leave
    #: as they are"; an empty list means "she removed the last one".
    custom_sources: list[str] | None = Field(default=None, max_length=20)


class ProfileResponse(Base):
    user_id: str
    name: str | None = None
    email: str | None = None
    picture: str | None = None
    tier: str = "free"
    listings_limit: int = 2
    listings_used: int = 0
    remaining: int = 0
    preferred_localities: list[str] = Field(default_factory=list)
    default_tenant_profile: str | None = None
    custom_sources: list[str] = Field(default_factory=list)


def _resolve_uid(body_uid: str, user: OptionalUser) -> str:
    """The uid to write, refusing to let the body impersonate another user.

    Signed in, the token's uid is authoritative and the body must match it.
    Signed out (auth disabled), the body is all there is, so it is taken as
    given — there is nothing to check it against.
    """
    if user is not None and user.uid not in ("anonymous", ""):
        if body_uid != user.uid:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="That profile belongs to a different signed-in user.",
            )
        return user.uid
    return body_uid


@router.post("/profile", response_model=ProfileResponse)
async def upsert_profile(body: ProfileRequest, user: OptionalUser = None) -> ProfileResponse:
    """Create or update the signed-in user's profile.

    Writes only the fields the client sent — a name-only update from a
    first-login prompt does not blank out saved localities — and never touches
    tier or quota, which the system grants and the client must not set.
    """
    uid = _resolve_uid(body.user_id, user)

    patch: dict[str, object] = {}
    if body.name is not None:
        patch["name"] = body.name.strip()
    if body.email is not None:
        patch["email"] = body.email.strip()
    if body.preferred_localities is not None:
        patch["preferred_localities"] = [x.strip() for x in body.preferred_localities if x.strip()]
    if body.default_tenant_profile is not None:
        patch["default_tenant_profile"] = body.default_tenant_profile.strip() or None
    if body.custom_sources is not None:
        patch["custom_sources"] = [x.strip() for x in body.custom_sources if x.strip()]

    if patch:
        await upsert_user(uid, patch)
        log.info("users: profile upserted for %s (%s)", uid, ", ".join(patch))

    return await _read_profile(uid)


@router.get("/profile/{user_id}", response_model=ProfileResponse)
async def get_profile(user_id: str, user: OptionalUser = None) -> ProfileResponse:
    """Fetch a profile with its plan tier and quota.

    A signed-in user may read only their own. Anonymous reads are allowed when
    auth is off, matching the write path — the demo has no token to gate on.
    """
    if user is not None and user.uid not in ("anonymous", "") and user.uid != user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only read your own profile.",
        )
    doc = await get_user(user_id)
    if not doc:
        raise HTTPException(status_code=404, detail="No profile for that user.")
    return await _read_profile(user_id, doc)


async def _read_profile(uid: str, doc: dict | None = None) -> ProfileResponse:
    """Assemble the response, reading quota fresh so it is never stale."""
    if doc is None:
        doc = await get_user(uid) or {}
    stored_tier, used = await read_quota_doc(uid)
    tier = normalise_tier(stored_tier)
    limit = limit_for(tier)
    quota = Quota(tier=tier, limit=limit, used=used)

    return ProfileResponse(
        user_id=uid,
        name=doc.get("name"),
        email=doc.get("email"),
        picture=doc.get("picture"),
        tier=tier.value,
        listings_limit=limit,
        listings_used=used,
        custom_sources=list(doc.get("custom_sources") or []),
        remaining=quota.remaining,
        preferred_localities=doc.get("preferred_localities") or [],
        default_tenant_profile=doc.get("default_tenant_profile"),
    )


# --------------------------------------------------------------------------
# dashboard
# --------------------------------------------------------------------------


class ActivityItem(Base):
    """One row of "recent activity"."""

    id: str
    address: str
    source: str
    match_score: int
    total_questions: int
    status: str
    created_at: datetime | None = None


class DashboardStats(Base):
    listings_matched: int = 0
    calls_completed: int = 0
    #: Average questions actually answered, and out of how many. Both zero when
    #: no call has completed — the UI shows an em dash rather than "0/0".
    avg_questions_hit: int = 0
    avg_questions_total: int = 0
    tier: str = "free"
    listings_limit: int = 2
    listings_used: int = 0


class DashboardResponse(Base):
    stats: DashboardStats
    activity: list[ActivityItem] = Field(default_factory=list)
    #: True when this account has never run a search. The dashboard shows the
    #: empty state on this rather than inferring it from zeroed stats, which a
    #: real-but-unlucky search could also produce.
    is_empty: bool = True


@router.get("/dashboard", response_model=DashboardResponse)
async def dashboard(user: OptionalUser = None) -> DashboardResponse:
    """Everything the overview panel shows, in one round trip.

    Signed in, this is that customer's own history. Signed out — which is the
    case whenever ``AUTH_REQUIRED`` is off — sessions carry no customer id, so
    the most recent ones are used instead; otherwise the demo would show an
    empty dashboard immediately after a successful search.
    """
    account = await require_user(user)
    uid = account.uid

    if uid and uid not in ("anonymous", ""):
        sessions = await list_sessions_for_customer(uid, limit=50)
    else:
        sessions = await list_recent_sessions(limit=50)

    session_ids = [x.id for x in sessions]
    calls = await calls_for_sessions(session_ids, limit=25)
    listings = await listings_by_ids([c.listing_id for c in calls if c.listing_id])

    completed = [c for c in calls if c.call_status is CallStatus.COMPLETED]

    # Averaged over completed calls only. Including a call that never connected
    # would drag the number down for a reason that has nothing to do with how
    # well the questions were answered.
    answered_total = sum(sum(1 for q in c.qna_pairs if q.answer) for c in completed)
    asked_total = sum(len(c.qna_pairs) for c in completed)
    n = len(completed) or 1

    stored_tier, used = await read_quota_doc(uid)
    tier = normalise_tier(stored_tier)

    activity: list[ActivityItem] = []
    for call in calls[:8]:
        listing = listings.get(call.listing_id)
        bits = []
        if listing:
            if listing.bedrooms is not None:
                bits.append(f"{listing.bedrooms}BHK")
            if listing.locality:
                bits.append(listing.locality)
        activity.append(
            ActivityItem(
                id=call.id,
                address=" · ".join(bits) or (listing.title if listing else None) or "Listing",
                source=(listing.source_site if listing else None) or "Khoj",
                match_score=sum(1 for q in call.qna_pairs if q.answer),
                total_questions=len(call.qna_pairs),
                status=call.call_status.value,
                created_at=call.created_at,
            )
        )

    return DashboardResponse(
        stats=DashboardStats(
            listings_matched=sum(x.listings_matched for x in sessions),
            calls_completed=len(completed),
            avg_questions_hit=round(answered_total / n) if completed else 0,
            avg_questions_total=round(asked_total / n) if completed else 0,
            tier=tier.value,
            listings_limit=limit_for(tier),
            listings_used=used,
        ),
        activity=activity,
        is_empty=not sessions,
    )
