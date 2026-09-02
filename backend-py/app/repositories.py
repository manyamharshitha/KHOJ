"""Typed Firestore access. The only module that knows the database exists.

Everything above this file works in Pydantic models. That boundary is what let
the TypeScript predecessor swap SQLite for Firestore without touching a single
route, and it is worth keeping.

Collections
-----------
``customers``       one document per signed-in user
``search_sessions`` one per search, holding the prompt and parsed criteria
``listings``        candidates found, keyed by session
``calls``           one per outbound attempt, with transcript and Q&A
``analyses``        one honesty report per completed call
"""

from __future__ import annotations

from datetime import timedelta
from typing import Any, TypeVar

from google.cloud.firestore_v1 import FieldFilter
from google.cloud.firestore_v1.base_query import BaseQuery

from app.firebase import get_db
from app.ids import new_id
from app.models import (
    CallLog,
    CallStatus,
    HonestyReport,
    Listing,
    SearchSession,
    SessionStatus,
    utcnow,
)

T = TypeVar("T")

CUSTOMERS = "customers"
SESSIONS = "search_sessions"
LISTINGS = "listings"
CALLS = "calls"
ANALYSES = "analyses"


__all__ = ["new_id"]  # re-exported: callers may import it from either place


def _clean(data: dict[str, Any]) -> dict[str, Any]:
    """Drop the ``id`` field — Firestore keeps it as the document key."""
    return {k: v for k, v in data.items() if k != "id"}


# --------------------------------------------------------------------------
# sessions
# --------------------------------------------------------------------------


async def create_session(session: SearchSession) -> str:
    await get_db().collection(SESSIONS).document(session.id).set(_clean(session.to_firestore()))
    return session.id


async def get_session(session_id: str) -> SearchSession | None:
    snap = await get_db().collection(SESSIONS).document(session_id).get()
    if not snap.exists:
        return None
    return SearchSession.model_validate({"id": snap.id, **(snap.to_dict() or {})})


async def update_session(session_id: str, **fields: Any) -> None:
    """Patch a session. ``updated_at`` is always refreshed."""
    fields["updated_at"] = utcnow()
    await get_db().collection(SESSIONS).document(session_id).update(fields)


async def set_session_status(
    session_id: str, status: SessionStatus, error: str | None = None
) -> None:
    await update_session(session_id, status=status.value, error=error)


async def list_sessions_for_customer(customer_id: str, limit: int = 25) -> list[SearchSession]:
    query = (
        get_db()
        .collection(SESSIONS)
        .where(filter=FieldFilter("customer_id", "==", customer_id))
        .order_by("created_at", direction="DESCENDING")
        .limit(limit)
    )
    return [
        SearchSession.model_validate({"id": d.id, **(d.to_dict() or {})})
        async for d in query.stream()
    ]


# --------------------------------------------------------------------------
# listings
# --------------------------------------------------------------------------


async def save_listings(listings: list[Listing]) -> None:
    """Write a batch of listings.

    Firestore caps a batch at 500 operations, so long result sets are chunked
    rather than failing at listing 501.
    """
    db = get_db()
    for i in range(0, len(listings), 400):
        batch = db.batch()
        for listing in listings[i : i + 400]:
            batch.set(db.collection(LISTINGS).document(listing.id), _clean(listing.to_firestore()))
        await batch.commit()


async def get_listing(listing_id: str) -> Listing | None:
    snap = await get_db().collection(LISTINGS).document(listing_id).get()
    if not snap.exists:
        return None
    data = snap.to_dict() or {}
    data.pop("total_monthly_cost", None)  # derived on the model, not a real field
    return Listing.model_validate({"id": snap.id, **data})


async def listings_for_session(session_id: str) -> list[Listing]:
    """Every listing in a session.

    Deliberately unordered here: ranking is a pure function in ``ranking.py`` and
    is applied in memory, so the tie-breaking rules live in one readable place
    rather than being split between a Firestore index and Python.
    """
    query = (
        get_db()
        .collection(LISTINGS)
        .where(filter=FieldFilter("session_id", "==", session_id))
    )
    out: list[Listing] = []
    async for doc in query.stream():
        data = doc.to_dict() or {}
        data.pop("total_monthly_cost", None)
        out.append(Listing.model_validate({"id": doc.id, **data}))
    return out


async def mark_listing_called(listing_id: str) -> None:
    await get_db().collection(LISTINGS).document(listing_id).update({"called": True})


# --------------------------------------------------------------------------
# calls
# --------------------------------------------------------------------------


async def create_call(call: CallLog) -> str:
    await get_db().collection(CALLS).document(call.id).set(_clean(call.to_firestore()))
    return call.id


async def get_call(call_id: str) -> CallLog | None:
    snap = await get_db().collection(CALLS).document(call_id).get()
    if not snap.exists:
        return None
    return CallLog.model_validate({"id": snap.id, **(snap.to_dict() or {})})


async def get_call_by_provider_id(provider_call_id: str) -> CallLog | None:
    """Look a call up by the telephony provider's id.

    Webhooks arrive knowing only the provider's identifier, so this is the hinge
    between their world and ours.
    """
    query = (
        get_db()
        .collection(CALLS)
        .where(filter=FieldFilter("provider_call_id", "==", provider_call_id))
        .limit(1)
    )
    async for doc in query.stream():
        return CallLog.model_validate({"id": doc.id, **(doc.to_dict() or {})})
    return None


async def update_call(call_id: str, **fields: Any) -> None:
    await get_db().collection(CALLS).document(call_id).update(fields)


async def save_call(call: CallLog) -> None:
    """Replace a whole call document — used when the transcript is finalised."""
    await get_db().collection(CALLS).document(call.id).set(_clean(call.to_firestore()))


async def calls_for_session(session_id: str) -> list[CallLog]:
    query = (
        get_db().collection(CALLS).where(filter=FieldFilter("session_id", "==", session_id))
    )
    return [
        CallLog.model_validate({"id": d.id, **(d.to_dict() or {})}) async for d in query.stream()
    ]


async def count_active_calls(session_id: str) -> int:
    """Calls occupying a line right now, for the concurrency cap."""
    query = (
        get_db()
        .collection(CALLS)
        .where(filter=FieldFilter("session_id", "==", session_id))
        .where(
            filter=FieldFilter(
                "call_status",
                "in",
                [CallStatus.DIALING.value, CallStatus.IN_PROGRESS.value],
            )
        )
    )
    result = await query.count().get()
    return int(result[0][0].value)


async def called_recently(phone_e164: str, within_days: int) -> bool:
    """Whether this number was dialled inside the cooldown, in any session.

    Prevents the same broker being called twice in a week by two different
    customers — which is how a useful service turns into a nuisance.
    """
    if within_days <= 0:
        return False
    cutoff = utcnow() - timedelta(days=within_days)
    query = (
        get_db()
        .collection(CALLS)
        .where(filter=FieldFilter("phone_dialed", "==", phone_e164))
        .where(filter=FieldFilter("created_at", ">", cutoff))
        .limit(1)
    )
    async for _ in query.stream():
        return True
    return False


# --------------------------------------------------------------------------
# analyses
# --------------------------------------------------------------------------


async def save_report(report: HonestyReport) -> str:
    await get_db().collection(ANALYSES).document(report.id).set(_clean(report.to_firestore()))
    return report.id


async def report_for_call(call_id: str) -> HonestyReport | None:
    query = (
        get_db().collection(ANALYSES).where(filter=FieldFilter("call_id", "==", call_id)).limit(1)
    )
    async for doc in query.stream():
        return HonestyReport.model_validate({"id": doc.id, **(doc.to_dict() or {})})
    return None


async def reports_for_session(session_id: str) -> list[HonestyReport]:
    query: BaseQuery = (
        get_db().collection(ANALYSES).where(filter=FieldFilter("session_id", "==", session_id))
    )
    return [
        HonestyReport.model_validate({"id": d.id, **(d.to_dict() or {})})
        async for d in query.stream()
    ]
