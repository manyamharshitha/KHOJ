"""Index creation, run once at startup.

Firestore Enterprise, like MongoDB, will happily answer a compound query with a
collection scan and no warning. That is invisible at demo scale and ruinous at
any other, so the indexes the application actually queries by are declared here
rather than left to whoever notices the latency first.

Creation is idempotent — ``create_index`` on an existing identical index is a
no-op — so this runs on every boot without accumulating anything.
"""

from __future__ import annotations

import logging
from collections.abc import Sequence
from typing import Any

from motor.motor_asyncio import AsyncIOMotorDatabase
from pymongo import ASCENDING, DESCENDING
from pymongo.errors import PyMongoError

log = logging.getLogger(__name__)

#: ``(collection, keys, options)``. Keys use the driver's list-of-pairs form so
#: compound ordering is explicit rather than dependent on dict insertion order.
INDEX_SPECS: list[tuple[str, Sequence[tuple[str, int]], dict[str, Any]]] = [
    # The hot path: every listing of one session, cheapest first.
    (
        "listings",
        [("session_id", ASCENDING), ("total_cost", ASCENDING)],
        {"name": "listings_session_cost"},
    ),
    # Ranking's tie-breaker, and the lookup the pipeline does per session.
    (
        "listings",
        [("session_id", ASCENDING), ("age_years", ASCENDING)],
        {"name": "listings_session_age"},
    ),
    # Verifications for the results page, newest first.
    (
        "verifications",
        [("session_id", ASCENDING), ("created_at", DESCENDING)],
        {"name": "verifications_session_created"},
    ),
    # One verification per listing per session — enforced, not just indexed, so
    # a retried call cannot silently produce two contradictory records.
    (
        "verifications",
        [("session_id", ASCENDING), ("listing_id", ASCENDING)],
        {"name": "verifications_session_listing", "unique": True},
    ),
    # Calls: session fan-out, the concurrency count, and the webhook hinge.
    ("calls", [("session_id", ASCENDING)], {"name": "calls_session"}),
    (
        "calls",
        [("session_id", ASCENDING), ("call_status", ASCENDING)],
        {"name": "calls_session_status"},
    ),
    ("calls", [("provider_call_id", ASCENDING)], {"name": "calls_provider_id", "sparse": True}),
    # The cooldown check — "was this number dialled in the last N days".
    (
        "calls",
        [("phone_dialed", ASCENDING), ("created_at", DESCENDING)],
        {"name": "calls_phone_created"},
    ),
    # Honesty reports, read back by call and by session.
    ("analyses", [("call_id", ASCENDING)], {"name": "analyses_call"}),
    ("analyses", [("session_id", ASCENDING)], {"name": "analyses_session"}),
    # A customer's search history, newest first.
    (
        "search_sessions",
        [("customer_id", ASCENDING), ("created_at", DESCENDING)],
        {"name": "sessions_customer_created"},
    ),
    # Leads, newest first for the admin view.
    ("agency_leads", [("created_at", DESCENDING)], {"name": "leads_created"}),
    (
        "agency_leads",
        [("status", ASCENDING), ("created_at", DESCENDING)],
        {"name": "leads_status_created"},
    ),
]

#: Unique on email, but only where an email exists.
#:
#: A plain ``unique=True`` would be wrong here. Anonymous and dev profiles carry
#: ``email=""``, and the second one written would collide with the first and be
#: rejected — locking users out of a product whose sign-in works fine. The
#: partial filter indexes only documents with a genuine address.
_EMAIL_INDEX = ("users", [("email", ASCENDING)], {
    "name": "users_email_unique",
    "unique": True,
    "partialFilterExpression": {"email": {"$gt": ""}},
})


async def ensure_indexes(db: AsyncIOMotorDatabase) -> list[str]:
    """Create every declared index. Returns the names that now exist.

    A failure here is logged and stepped over rather than raised. An index that
    could not be created is a performance problem; refusing to boot over one
    turns it into an outage, and the deploy user may legitimately lack the
    privilege to issue DDL.
    """
    created: list[str] = []

    for collection, keys, options in [*INDEX_SPECS, _EMAIL_INDEX]:
        name = options.get("name", "?")
        try:
            await db[collection].create_index(list(keys), **options)
            created.append(f"{collection}.{name}")
        except PyMongoError as exc:
            if collection == "users" and "partialFilterExpression" in options:
                # Some deployments reject partial indexes. A sparse unique index
                # is the next best thing: it still catches duplicate real
                # addresses, it just also indexes the empty-string profiles.
                try:
                    await db[collection].create_index(
                        list(keys), name=options["name"], unique=True, sparse=True
                    )
                    created.append(f"{collection}.{name} (sparse fallback)")
                    continue
                except PyMongoError as inner:
                    log.warning("indexes: %s.%s could not be created (%s)", collection, name, inner)
                    continue
            log.warning("indexes: %s.%s could not be created (%s)", collection, name, exc)

    log.info("indexes: %d of %d ready", len(created), len(INDEX_SPECS) + 1)
    return created
