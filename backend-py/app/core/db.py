"""MongoDB connection lifecycle for Firestore Enterprise edition.

Firestore Enterprise implements the MongoDB wire protocol, so the data layer is
a MongoDB driver rather than ``firebase-admin``. ``firebase_admin`` is still
imported elsewhere, but only by :mod:`app.core.auth` to verify Google ID tokens
— it no longer reads or writes a single document.

The client is created on FastAPI startup and closed on shutdown. That timing is
load-bearing: ``AsyncIOMotorClient`` binds to the running event loop when it is
constructed, so building one at import time gives you a client attached to a
loop that is never the one serving requests, and every query hangs.

Tests never reach a real server. :func:`use_database` swaps in an
``AsyncMongoMockClient`` database, because the Firebase CLI emulator does not
implement the MongoDB wire protocol and there is nothing local to point at.
"""

from __future__ import annotations

import logging
from typing import Any

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from pymongo.errors import PyMongoError

from app.config import settings

log = logging.getLogger(__name__)

_client: AsyncIOMotorClient | None = None
_db: AsyncIOMotorDatabase | None = None


class DatabaseNotReady(RuntimeError):
    """Raised when a query is attempted before startup connected the client.

    Explicit, because the alternative symptom is ``AttributeError: 'NoneType'
    object has no attribute 'users'`` from somewhere deep in a repository.
    """


def _client_kwargs() -> dict[str, Any]:
    """Driver options.

    TLS is only forced when the URI does not already say. Passing ``tls=True``
    alongside a URI carrying ``ssl=false`` is a hard ``ConfigurationError`` at
    construction, so the URI keeps the final say and this only supplies a secure
    default when it is silent.
    """
    kwargs: dict[str, Any] = {
        "maxPoolSize": settings.mongo_max_pool_size,
        "minPoolSize": settings.mongo_min_pool_size,
        "serverSelectionTimeoutMS": settings.mongo_server_selection_timeout_ms,
        "connectTimeoutMS": settings.mongo_connect_timeout_ms,
        "appname": "khoj-api",
        # Round-trips UUIDs the same way every other modern driver does, rather
        # than the legacy Python-only representation.
        "uuidRepresentation": "standard",
    }
    uri = (settings.firestore_enterprise_uri or "").lower()
    if "ssl=" not in uri and "tls=" not in uri:
        kwargs["tls"] = True
    return kwargs


async def connect() -> AsyncIOMotorDatabase:
    """Open the pool and confirm the server actually answers.

    The ping matters. Without it a bad URI or a firewall surfaces on the first
    real query — inside a search, after the customer has already waited — rather
    than at boot where it belongs.
    """
    global _client, _db

    if _db is not None:
        return _db

    uri = (settings.firestore_enterprise_uri or "").strip()

    # Checked here rather than left to the driver. ``InvalidURI: Invalid URI
    # scheme`` does not tell anyone which setting is wrong or where to get a
    # right one, and this is the first thing that fails on a fresh deploy.
    if not uri or uri == "FILL_ME":
        raise DatabaseNotReady(
            "FIRESTORE_ENTERPRISE_URI is not set. Get the connection string from "
            "the Google Cloud console: Firestore -> your database -> Connect. "
            "You will also need a database user, created on that same page."
        )
    if not uri.startswith(("mongodb://", "mongodb+srv://")):
        # The common paste error, called out by name. Google shows the string as
        # ``mongodb://<username>:<password>@host/...`` and the placeholder half
        # is easy to lose on the way to a .env, leaving a value that begins at
        # the "@" and looks superficially plausible.
        if uri.startswith("@"):
            raise DatabaseNotReady(
                "FIRESTORE_ENTERPRISE_URI is missing its scheme and credentials. "
                "The host and options look right, but the value starts at '@' — "
                "the 'mongodb://USERNAME:PASSWORD' prefix is missing. Create a "
                "database user in the Google Cloud console (Firestore -> your "
                "database -> Authentication) and prepend "
                "'mongodb://<user>:<password>' to what you already have."
            )
        raise DatabaseNotReady(
            "FIRESTORE_ENTERPRISE_URI must start with mongodb:// or mongodb+srv:// "
            f"— got {uri[:40]!r}. Firestore Enterprise speaks the MongoDB wire "
            "protocol, so this is a MongoDB connection string, not a Firebase "
            "project id or a REST endpoint."
        )

    _client = AsyncIOMotorClient(uri, **_client_kwargs())
    _db = _client[settings.database_name]

    try:
        await _client.admin.command("ping")
    except PyMongoError as exc:
        _client.close()
        _client, _db = None, None
        raise DatabaseNotReady(f"Could not reach the database: {exc}") from exc

    log.info("db: connected to %s", settings.database_name)
    return _db


async def disconnect() -> None:
    """Close the pool. Safe to call when never connected."""
    global _client, _db
    if _client is not None:
        _client.close()
        log.info("db: connection closed")
    _client, _db = None, None


def get_db() -> AsyncIOMotorDatabase:
    """The database handle every repository call goes through."""
    if _db is None:
        raise DatabaseNotReady(
            "The database is not connected. This is called before application "
            "startup, or outside the app entirely — tests should call "
            "use_database() with a mock client."
        )
    return _db


def use_database(db: AsyncIOMotorDatabase | None) -> None:
    """Point the repositories at a specific database.

    Used by the test suite to inject ``AsyncMongoMockClient``, and by nothing
    else. Passing ``None`` resets to the disconnected state.
    """
    global _db
    _db = db


async def ping() -> bool:
    """Whether the database answers right now. Never raises."""
    if _db is None:
        return False
    try:
        await _db.command("ping")
        return True
    except Exception:  # noqa: BLE001 - health checks report, they do not crash
        return False
