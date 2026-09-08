"""Roles, broker profiles, and the two dashboards.

Khoj now has two sides. A renter looks for a flat; a broker receives the calls
and the video requests that follow. They see genuinely different things, and the
separation is enforced here rather than in the frontend: a dashboard that hides
a section is a UI preference, while a route that refuses to return it is a
permission.

One join is worth stating plainly. A call has no broker id on it — the number
was scraped off a listing long before anyone knew an account claimed it — so a
broker's inbound calls are found by matching the number they registered. That
means a broker sees calls to their own number and nothing else, and it means
registering a number you do not own would show you someone else's calls. Numbers
are therefore taken from the profile and never from the request body at read
time; a stronger check (an SMS round trip) is the obvious next step and is not
in place yet.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, status
from pydantic import Field

from app.core.auth import OptionalUser, require_user
from app.llm.extractor import to_e164
from app.models import Base, BrokerProfile, UserType
from app.repositories import (
    broker_by_phone,
    calls_for_customer,
    calls_to_phone,
    count_unread,
    get_broker_profile,
    get_user_type,
    negotiations_for_user,
    save_broker_profile,
    set_user_type,
    site_visits_for_phone,
    site_visits_for_user,
)

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["brokers"])


class RoleRequest(Base):
    user_type: UserType


class BrokerProfileRequest(Base):
    business_name: str = Field(min_length=1, max_length=200)
    contact_name: str | None = Field(default=None, max_length=120)
    phone: str | None = None
    email: str | None = None
    address: str | None = Field(default=None, max_length=400)
    business_license: str | None = Field(default=None, max_length=120)


@router.get("/me/role")
async def read_role(user: OptionalUser) -> dict[str, str]:
    account = await require_user(user)
    return {"uid": account.uid, "user_type": (await get_user_type(account.uid)).value}


@router.post("/me/role")
async def choose_role(body: RoleRequest, user: OptionalUser) -> dict[str, str]:
    """Pick a side. Reversible — this is a view, not an identity."""
    account = await require_user(user)
    await set_user_type(account.uid, body.user_type)
    log.info("role: %s is now a %s", account.uid, body.user_type.value)
    return {"uid": account.uid, "user_type": body.user_type.value}


@router.post("/broker/profile")
async def upsert_broker_profile(
    body: BrokerProfileRequest, user: OptionalUser
) -> dict[str, object]:
    """Create or update the broker's business profile.

    Saving a profile makes the account a broker: there is no sensible state
    where somebody has filled in a business name and is still filed as a renter.
    """
    account = await require_user(user)

    phone = to_e164(body.phone) if body.phone else None
    if body.phone and not phone:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="That does not look like an Indian mobile number.",
        )

    if phone:
        # One number, one account. Without this two brokers could both claim a
        # number and each would be shown the other's inbound calls.
        existing = await broker_by_phone(phone)
        if existing is not None and existing.uid != account.uid:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Another account has already registered that number.",
            )

    current = await get_broker_profile(account.uid)
    earned: dict[str, object] = {}
    if current is not None:
        # Carried forward, because these are earned and a profile edit must not
        # reset them. Omitted rather than passed as None for a first save:
        # passing created_at=None explicitly overrides the default_factory and
        # fails validation, which is not the same thing as leaving it unset.
        earned = {
            "reputation_score": current.reputation_score,
            "calls_received": current.calls_received,
            "visits_completed": current.visits_completed,
            "created_at": current.created_at,
        }

    profile = BrokerProfile(
        uid=account.uid,
        business_name=body.business_name,
        contact_name=body.contact_name,
        phone=phone,
        email=body.email,
        address=body.address,
        business_license=body.business_license,
        **earned,  # type: ignore[arg-type]
    )
    await save_broker_profile(profile)
    await set_user_type(account.uid, UserType.BROKER)
    return {"profile": profile.model_dump(mode="json")}


@router.get("/broker/profile")
async def read_broker_profile(user: OptionalUser) -> dict[str, object]:
    account = await require_user(user)
    profile = await get_broker_profile(account.uid)
    return {"profile": profile.model_dump(mode="json") if profile else None}


@router.get("/dashboard/renter")
async def renter_dashboard(user: OptionalUser) -> dict[str, object]:
    """What the renter side shows: their own visits, negotiations and calls."""
    account = await require_user(user)
    visits = await site_visits_for_user(account.uid, limit=25)
    negotiations = await negotiations_for_user(account.uid, limit=25)
    calls = await calls_for_customer(account.uid, limit=25)

    return {
        "user_type": UserType.RENTER.value,
        "unread_notifications": await count_unread(account.uid),
        "site_visits": [v.model_dump(mode="json") for v in visits],
        "negotiations": [n.model_dump(mode="json") for n in negotiations],
        "calls": [c.model_dump(mode="json") for c in calls],
        "stats": {
            "visits_requested": len(visits),
            "visits_verified": sum(1 for v in visits if v.is_verified),
            "negotiations_open": sum(1 for n in negotiations if n.status.value == "open"),
            "calls_placed": len(calls),
        },
    }


@router.get("/dashboard/broker")
async def broker_dashboard(user: OptionalUser) -> dict[str, object]:
    """What the broker side shows: calls and visit requests aimed at them.

    A broker with no registered number gets empty lists and a note saying why,
    rather than a 404. There is nothing wrong with the account — it simply has
    no number for anything to be joined on yet.
    """
    account = await require_user(user)
    profile = await get_broker_profile(account.uid)

    if profile is None or not profile.phone:
        return {
            "user_type": UserType.BROKER.value,
            "profile": profile.model_dump(mode="json") if profile else None,
            "needs_phone": True,
            "note": (
                "Add your business phone number to see calls and verification "
                "requests. They are matched to you by the number on your listings."
            ),
            "unread_notifications": await count_unread(account.uid),
            "calls": [],
            "site_visits": [],
            "stats": {},
        }

    calls = await calls_to_phone(profile.phone, limit=50)
    visits = await site_visits_for_phone(profile.phone, limit=50)
    completed = [v for v in visits if v.is_verified]

    return {
        "user_type": UserType.BROKER.value,
        "profile": profile.model_dump(mode="json"),
        "needs_phone": False,
        "unread_notifications": await count_unread(account.uid),
        "calls": [c.model_dump(mode="json") for c in calls],
        "site_visits": [v.model_dump(mode="json") for v in visits],
        "stats": {
            "calls_received": len(calls),
            "visits_requested": len(visits),
            "visits_verified": len(completed),
            # Left null until there is something to compute it from. Zero reads
            # as "rated badly"; a broker with no history is unrated.
            "reputation_score": profile.reputation_score,
        },
    }
