"""Typed database access. The only module that knows the database exists.

Everything above this file works in Pydantic models. That boundary is what let
the TypeScript predecessor swap SQLite for Firestore without touching a single
route, and it is what made this migration from native Firestore to Firestore
Enterprise's MongoDB wire protocol a rewrite of one file rather than of the
whole service.

Collections
-----------
``users``            one document per signed-in customer, holding tier and quota
``search_sessions``  one per search, with the prompt and parsed criteria
``listings``         candidates found, keyed by session
``calls``            one per outbound attempt, with transcript and Q&A
``analyses``         one honesty report per completed call
``verifications``    the customer-facing record of one verified listing
``agency_leads``     inbound requests for a plan above Premium

Identity
--------
Every ``_id`` here is an application-generated string — ``ses_x9f2``, ``lst_a01``
— produced by :func:`app.ids.new_id`. No ``ObjectId`` is ever created, so
nothing has to be stringified on the way out and no BSON type reaches the API
layer. :func:`_from_doc` maps ``_id`` onto the model's ``id`` field on read;
:func:`_to_doc` does the reverse on write.
"""

from __future__ import annotations

import logging
from collections.abc import Mapping
from datetime import timedelta
from typing import Any, TypeVar

from pymongo import ASCENDING, DESCENDING, ReturnDocument, UpdateOne

from app.core.db import get_db
from app.ids import new_id
from app.models import (
    AgencyLead,
    CallLog,
    CallStatus,
    HonestyReport,
    Listing,
    SearchSession,
    SessionStatus,
    UserProfile,
    Verification,
    as_utc,
    utcnow,
)

log = logging.getLogger(__name__)

T = TypeVar("T")

USERS = "users"
SESSIONS = "search_sessions"
LISTINGS = "listings"
CALLS = "calls"
ANALYSES = "analyses"
VERIFICATIONS = "verifications"
AGENCY_LEADS = "agency_leads"
LOCALITY_CACHE = "locality_cache"

#: Written by ``Listing.to_document`` for the index and recomputed in memory by
#: ``rank_listings``. Stripped on read: the model declares it as a property and
#: would reject it under ``extra="forbid"``.
_DERIVED_FIELDS = ("total_cost", "total_monthly_cost")

__all__ = ["new_id"]  # re-exported: callers may import it from either place


# --------------------------------------------------------------------------
# document <-> model
# --------------------------------------------------------------------------


def _from_doc(doc: Mapping[str, Any] | None, id_field: str = "id") -> dict[str, Any] | None:
    """A raw document to model kwargs.

    Three things happen here and nowhere else: ``_id`` becomes the model's id
    field, fields written only for indexing are dropped, and naive datetimes get
    UTC put back on them. BSON has no timezone, so every stored ``created_at``
    reads back naive and would raise on the first comparison against
    :func:`app.models.utcnow`.
    """
    if doc is None:
        return None
    out = {k: as_utc(v) for k, v in doc.items()}
    doc_id = out.pop("_id", None)
    if doc_id is not None:
        out[id_field] = doc_id
    for field in _DERIVED_FIELDS:
        out.pop(field, None)
    return out


def _to_doc(model: Any, id_field: str = "id") -> tuple[Any, dict[str, Any]]:
    """A model to ``(_id, body)``.

    The id comes back separately rather than staying in the body because Mongo
    rejects any update touching ``_id`` — including one that sets it to the
    value it already holds.
    """
    data = model.to_document()
    return data.pop(id_field, None), data


def _model(cls: type[T], doc: Mapping[str, Any] | None, id_field: str = "id") -> T | None:
    kwargs = _from_doc(doc, id_field)
    return cls.model_validate(kwargs) if kwargs is not None else None


# --------------------------------------------------------------------------
# users, tiers and quota
# --------------------------------------------------------------------------


async def upsert_user(uid: str, payload: Mapping[str, Any]) -> None:
    """Create or patch a profile. Never clobbers tier or usage."""
    await get_db()[USERS].update_one({"_id": uid}, {"$set": dict(payload)}, upsert=True)


async def get_user(uid: str) -> dict[str, Any] | None:
    """The raw profile document, or ``None``."""
    return await get_db()[USERS].find_one({"_id": uid})


async def create_user_if_absent(profile: UserProfile) -> dict[str, Any]:
    """Insert a profile only if the uid is new, and return whatever now exists.

    ``$setOnInsert`` rather than read-then-write: two sign-ins racing on a first
    login would otherwise both see "no document", and the second would overwrite
    the first — resetting a tier that had just been granted.
    """
    _, body = _to_doc(profile, "uid")
    body["last_seen_at"] = utcnow()
    doc = await get_db()[USERS].find_one_and_update(
        {"_id": profile.uid},
        {"$setOnInsert": body},
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    return doc or {}


async def touch_user(uid: str, **fields: Any) -> None:
    """Refresh the volatile parts of a profile — name, avatar, last seen."""
    fields["last_seen_at"] = utcnow()
    await get_db()[USERS].update_one({"_id": uid}, {"$set": fields})


async def set_user_tier(uid: str, tier: str, listings_limit: int) -> dict[str, Any] | None:
    """Move a user to another plan and return the updated document."""
    return await get_db()[USERS].find_one_and_update(
        {"_id": uid},
        {"$set": {"tier": tier, "listings_limit": listings_limit, "updated_at": utcnow()}},
        return_document=ReturnDocument.AFTER,
    )


async def consume_quota_atomic(uid: str, plan_limit: int, count: int = 1) -> bool:
    """Spend ``count`` verifications if — and only if — the plan still allows it.

    The guard lives in the filter, not in Python. A read-modify-write would let
    two searches running at once both read the same ``listings_used``, both
    decide there was room, and both increment — handing out free phone calls and
    leaving the counter behind reality.

    ``$lte: plan_limit - count`` rather than ``$lt: plan_limit`` because a
    multi-listing charge must not straddle the ceiling: with one verification
    left, a request for three is refused outright rather than partly granted.

    Returns ``True`` if the quota was spent, ``False`` if the plan was already
    exhausted. The caller must not place a call on ``False``.
    """
    if count <= 0:
        return True

    result = await get_db()[USERS].update_one(
        {"_id": uid, "listings_used": {"$lte": plan_limit - count}},
        {"$inc": {"listings_used": count}, "$set": {"updated_at": utcnow()}},
    )
    if result.modified_count != 1:
        log.info("quota: refused %d for %s (limit %d)", count, uid, plan_limit)
        return False
    return True


async def read_quota_doc(uid: str) -> tuple[str | None, int]:
    """``(tier, listings_used)`` straight from the database.

    Read fresh at the moment of dialling rather than trusted from the session,
    because a plan can change while a long search is running.
    """
    doc = await get_db()[USERS].find_one({"_id": uid}, {"tier": 1, "listings_used": 1})
    if not doc:
        return None, 0
    return doc.get("tier"), int(doc.get("listings_used") or 0)


# --------------------------------------------------------------------------
# sessions
# --------------------------------------------------------------------------


async def save_session(session: SearchSession) -> str:
    """Upsert a whole session document."""
    doc_id, body = _to_doc(session)
    await get_db()[SESSIONS].update_one({"_id": doc_id}, {"$set": body}, upsert=True)
    return session.id


async def create_session(session: SearchSession) -> str:
    return await save_session(session)


async def get_session(session_id: str) -> SearchSession | None:
    return _model(SearchSession, await get_db()[SESSIONS].find_one({"_id": session_id}))


async def update_session(session_id: str, **fields: Any) -> None:
    """Patch a session. ``updated_at`` is always refreshed."""
    fields["updated_at"] = utcnow()
    await get_db()[SESSIONS].update_one({"_id": session_id}, {"$set": fields})


async def set_session_status(
    session_id: str, status: SessionStatus, error: str | None = None
) -> None:
    await update_session(session_id, status=status.value, error=error)


async def list_recent_sessions(limit: int = 25) -> list[SearchSession]:
    """The most recent searches, whoever ran them.

    Used when nobody is signed in — with ``AUTH_REQUIRED`` off a session is
    stored with ``customer_id=None``, so filtering by customer would return an
    empty history for the very setup that is being demonstrated.
    """
    cursor = get_db()[SESSIONS].find({}).sort([("created_at", DESCENDING)]).limit(limit)
    return [_model(SearchSession, d) async for d in cursor]


async def list_sessions_for_customer(customer_id: str, limit: int = 25) -> list[SearchSession]:
    cursor = (
        get_db()[SESSIONS]
        .find({"customer_id": customer_id})
        .sort([("created_at", DESCENDING)])
        .limit(limit)
    )
    return [_model(SearchSession, d) async for d in cursor]


# --------------------------------------------------------------------------
# listings
# --------------------------------------------------------------------------


async def save_listings(listings: list[Listing]) -> int:
    """Write a batch of listings in one round trip per chunk.

    ``bulk_write`` with ``UpdateOne(upsert=True)`` rather than ``insert_many``:
    re-crawling a session must update the listings it finds again, not fail the
    whole batch on the first duplicate ``_id``.

    ``ordered=False`` lets the remaining operations proceed when one document is
    rejected — losing a single malformed listing beats losing the other 24.
    """
    if not listings:
        return 0

    written = 0
    for start in range(0, len(listings), 500):
        operations = []
        for listing in listings[start : start + 500]:
            doc_id, body = _to_doc(listing)
            operations.append(UpdateOne({"_id": doc_id}, {"$set": body}, upsert=True))
        result = await get_db()[LISTINGS].bulk_write(operations, ordered=False)
        written += (result.upserted_count or 0) + (result.modified_count or 0)
    return written


async def get_listing(listing_id: str) -> Listing | None:
    return _model(Listing, await get_db()[LISTINGS].find_one({"_id": listing_id}))


async def listings_for_session(session_id: str) -> list[Listing]:
    """Every listing in a session, pre-sorted cheapest first.

    The sort is served by the ``(session_id, total_cost)`` index, but it is not
    the authority — :func:`app.ranking.rank_listings` is, and callers still
    apply it. MongoDB orders nulls *first* ascending, so a listing whose price
    the portal hid would lead the results here: the exact inversion this product
    exists to prevent. The database sort narrows the work; ranking decides.
    """
    cursor = (
        get_db()[LISTINGS]
        .find({"session_id": session_id})
        .sort([("total_cost", ASCENDING), ("age_years", ASCENDING)])
    )
    return [_model(Listing, d) async for d in cursor]


async def get_listings_by_session(session_id: str, limit: int = 100) -> list[Listing]:
    """The first ``limit`` listings of a session, cheapest then newest.

    Same caveat as :func:`listings_for_session` about null ordering.
    """
    docs = (
        await get_db()[LISTINGS]
        .find({"session_id": session_id})
        .sort([("total_cost", ASCENDING), ("age_years", ASCENDING)])
        .to_list(length=limit)
    )
    return [_model(Listing, d) for d in docs]


async def mark_listing_called(listing_id: str) -> None:
    await get_db()[LISTINGS].update_one({"_id": listing_id}, {"$set": {"called": True}})


# --------------------------------------------------------------------------
# calls
# --------------------------------------------------------------------------


async def save_call(call: CallLog) -> None:
    """Upsert a whole call document — also used when the transcript lands."""
    doc_id, body = _to_doc(call)
    await get_db()[CALLS].update_one({"_id": doc_id}, {"$set": body}, upsert=True)


async def create_call(call: CallLog) -> str:
    await save_call(call)
    return call.id


async def get_call(call_id: str) -> CallLog | None:
    return _model(CallLog, await get_db()[CALLS].find_one({"_id": call_id}))


async def get_call_by_provider_id(provider_call_id: str) -> CallLog | None:
    """Look a call up by the telephony provider's id.

    Webhooks arrive knowing only the provider's identifier, so this is the hinge
    between their world and ours.
    """
    return _model(CallLog, await get_db()[CALLS].find_one({"provider_call_id": provider_call_id}))


async def update_call(call_id: str, **fields: Any) -> None:
    await get_db()[CALLS].update_one({"_id": call_id}, {"$set": fields})


async def calls_for_session(session_id: str) -> list[CallLog]:
    cursor = get_db()[CALLS].find({"session_id": session_id})
    return [_model(CallLog, d) async for d in cursor]


async def count_active_calls(session_id: str) -> int:
    """Calls occupying a line right now, for the concurrency cap."""
    return await get_db()[CALLS].count_documents(
        {
            "session_id": session_id,
            "call_status": {"$in": [CallStatus.DIALING.value, CallStatus.IN_PROGRESS.value]},
        }
    )


async def called_recently(phone_e164: str, within_days: int) -> bool:
    """Whether this number was dialled inside the cooldown, in any session.

    Prevents the same broker being called twice in a week by two different
    customers — which is how a useful service turns into a nuisance.
    """
    if within_days <= 0:
        return False
    cutoff = utcnow() - timedelta(days=within_days)
    doc = await get_db()[CALLS].find_one(
        {"phone_dialed": phone_e164, "created_at": {"$gt": cutoff}}, {"_id": 1}
    )
    return doc is not None


# --------------------------------------------------------------------------
# analyses
# --------------------------------------------------------------------------


async def save_report(report: HonestyReport) -> str:
    doc_id, body = _to_doc(report)
    await get_db()[ANALYSES].update_one({"_id": doc_id}, {"$set": body}, upsert=True)
    return report.id


async def report_for_call(call_id: str) -> HonestyReport | None:
    return _model(HonestyReport, await get_db()[ANALYSES].find_one({"call_id": call_id}))


async def reports_for_session(session_id: str) -> list[HonestyReport]:
    cursor = get_db()[ANALYSES].find({"session_id": session_id})
    return [_model(HonestyReport, d) async for d in cursor]


# --------------------------------------------------------------------------
# verifications
# --------------------------------------------------------------------------


def _verification_id(session_id: str, listing_id: str) -> str:
    """One verification per listing per session.

    Firestore held these in a subcollection under the session. Mongo has no
    subcollections, so the parent is folded into the key — preserving the same
    guarantee that a retried call overwrites its own record instead of leaving
    two contradictory ones behind.
    """
    return f"{session_id}:{listing_id}"


async def save_verification(session_id: str, verification: Verification) -> str:
    """Persist the customer-facing record of one verification.

    Written even for a call that never connected. "We rang and nobody answered"
    is a real result the customer paid for; leaving a silent gap would look like
    the listing was simply skipped.
    """
    doc_id = _verification_id(session_id, verification.listing_id)
    body = verification.to_document()
    body["session_id"] = session_id
    await get_db()[VERIFICATIONS].update_one({"_id": doc_id}, {"$set": body}, upsert=True)
    return doc_id


def _verification_from_doc(doc: Mapping[str, Any]) -> Verification:
    """Strip the two keys that exist for storage rather than for the model."""
    data = _from_doc(doc) or {}
    data.pop("id", None)  # the composite key
    data.pop("session_id", None)  # the query field
    return Verification.model_validate(data)


async def get_session_verifications(session_id: str) -> list[Verification]:
    """Every verification for a session, newest first."""
    cursor = (
        get_db()[VERIFICATIONS]
        .find({"session_id": session_id})
        .sort([("created_at", DESCENDING)])
    )
    return [_verification_from_doc(doc) async for doc in cursor]


async def get_verification(session_id: str, listing_id: str) -> Verification | None:
    doc = await get_db()[VERIFICATIONS].find_one({"_id": _verification_id(session_id, listing_id)})
    return _verification_from_doc(doc) if doc is not None else None


# --------------------------------------------------------------------------
# agency leads
# --------------------------------------------------------------------------


async def save_agency_lead(lead: AgencyLead) -> str:
    """Store an inbound request for a plan above Premium.

    Durable first, notified second. This is a warm lead from somebody who has
    already hit a paid ceiling, and a dropped webhook must never be able to lose
    it — so the write lands before any notification is attempted.
    """
    doc_id, body = _to_doc(lead)
    body.setdefault("status", "new")
    body.setdefault("created_at", utcnow())
    await get_db()[AGENCY_LEADS].update_one({"_id": doc_id}, {"$set": body}, upsert=True)
    return lead.id


async def mark_lead_notified(lead_id: str, delivered: bool, detail: str | None) -> None:
    """Record whether the admin notification actually went out."""
    await get_db()[AGENCY_LEADS].update_one(
        {"_id": lead_id},
        {"$set": {"notified": delivered, "notification_detail": detail}},
    )


async def get_agency_lead(lead_id: str) -> AgencyLead | None:
    return _model(AgencyLead, await get_db()[AGENCY_LEADS].find_one({"_id": lead_id}))


async def list_agency_leads(limit: int = 50) -> list[AgencyLead]:
    """Newest leads first — the order an admin wants to work them in."""
    docs = (
        await get_db()[AGENCY_LEADS]
        .find({})
        .sort([("created_at", DESCENDING)])
        .to_list(length=limit)
    )
    return [_model(AgencyLead, d) for d in docs]


# --------------------------------------------------------------------------
# locality context
# --------------------------------------------------------------------------


def _locality_key(locality: str, city: str | None) -> str:
    return f"{(locality or '').strip().lower()}|{(city or '').strip().lower()}"


async def get_cached_locality(
    locality: str, city: str | None, max_age_days: int = 30
) -> dict[str, Any] | None:
    """A previously summarised locality, if it is still fresh.

    Cached across sessions and users on purpose: a hundred people searching
    Kondapur should cost one Reddit fetch and one model call, not a hundred.
    What residents say about an area changes over months, not hours, so a long
    expiry is honest rather than lazy.
    """
    doc = await get_db()[LOCALITY_CACHE].find_one({"_id": _locality_key(locality, city)})
    if not doc:
        return None
    cached_at = as_utc(doc.get("cached_at"))
    if cached_at and (utcnow() - cached_at) > timedelta(days=max_age_days):
        return None
    return doc.get("context")


async def save_cached_locality(locality: str, city: str | None, context: dict[str, Any]) -> None:
    """Cache a locality summary. Failures here must not fail the request."""
    await get_db()[LOCALITY_CACHE].update_one(
        {"_id": _locality_key(locality, city)},
        {"$set": {"context": context, "cached_at": utcnow(), "locality": locality, "city": city}},
        upsert=True,
    )


# --------------------------------------------------------------------------
# dashboard aggregates
# --------------------------------------------------------------------------


async def calls_for_sessions(session_ids: list[str], limit: int = 25) -> list[CallLog]:
    """Recent calls across several searches, newest first.

    One query with ``$in`` rather than a loop over sessions: the dashboard shows
    a handful of rows and must not cost one round trip per search the customer
    has ever run.
    """
    if not session_ids:
        return []
    docs = (
        await get_db()[CALLS]
        .find({"session_id": {"$in": session_ids}})
        .sort([("created_at", DESCENDING)])
        .to_list(length=limit)
    )
    return [_model(CallLog, d) for d in docs]


async def listings_by_ids(listing_ids: list[str]) -> dict[str, Listing]:
    """The listings behind a set of calls, keyed by id."""
    if not listing_ids:
        return {}
    docs = await get_db()[LISTINGS].find({"_id": {"$in": listing_ids}}).to_list(length=len(listing_ids))
    out: dict[str, Listing] = {}
    for doc in docs:
        listing = _model(Listing, doc)
        if listing is not None:
            out[listing.id] = listing
    return out
