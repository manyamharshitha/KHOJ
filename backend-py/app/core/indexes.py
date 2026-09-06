
from __future__ import annotations

import logging
from collections.abc import Sequence
from typing import Any

from motor.motor_asyncio import AsyncIOMotorDatabase
from pymongo import ASCENDING, DESCENDING
from pymongo.errors import PyMongoError

log = logging.getLogger(__name__)
INDEX_SPECS: list[tuple[str, Sequence[tuple[str, int]], dict[str, Any]]] = [
    (
        "listings",
        [("session_id", ASCENDING), ("total_cost", ASCENDING)],
        {"name": "listings_session_cost"},
    ),
    (
        "listings",
        [("session_id", ASCENDING), ("age_years", ASCENDING)],
        {"name": "listings_session_age"},
    ),
    (
        "verifications",
        [("session_id", ASCENDING), ("created_at", DESCENDING)],
        {"name": "verifications_session_created"},
    ),
    (
        "verifications",
        [("session_id", ASCENDING), ("listing_id", ASCENDING)],
        {"name": "verifications_session_listing", "unique": True},
    ),
    ("calls", [("session_id", ASCENDING)], {"name": "calls_session"}),
    (
        "calls",
        [("session_id", ASCENDING), ("call_status", ASCENDING)],
        {"name": "calls_session_status"},
    ),
    ("calls", [("provider_call_id", ASCENDING)], {"name": "calls_provider_id", "sparse": True}),
    (
        "calls",
        [("phone_dialed", ASCENDING), ("created_at", DESCENDING)],
        {"name": "calls_phone_created"},
    ),

    ("analyses", [("call_id", ASCENDING)], {"name": "analyses_call"}),
    ("analyses", [("session_id", ASCENDING)], {"name": "analyses_session"}),
    (
        "search_sessions",
        [("customer_id", ASCENDING), ("created_at", DESCENDING)],
        {"name": "sessions_customer_created"},
    ),
    ("agency_leads", [("created_at", DESCENDING)], {"name": "leads_created"}),
    (
        "agency_leads",
        [("status", ASCENDING), ("created_at", DESCENDING)],
        {"name": "leads_status_created"},
    ),
]
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
