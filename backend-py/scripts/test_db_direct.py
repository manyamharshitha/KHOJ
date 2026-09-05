"""Test the database connection on its own, and name the exact failure.

The app's startup wraps a database problem in FastAPI's lifespan machinery, and
a request that hits an unreachable cluster hangs until a timeout fires. This
strips all of that away: connect with the real URI, run one ping, and print the
specific exception — which is the difference between "wrong password", "wrong
host", "firewalled", and "TLS mismatch", all of which otherwise look identical
from the outside.

    python scripts/test_db_direct.py

Exit code is 0 only when the ping succeeds.
"""

from __future__ import annotations

import asyncio
import logging
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from motor.motor_asyncio import AsyncIOMotorClient
from pymongo.errors import (
    ConfigurationError,
    OperationFailure,
    ServerSelectionTimeoutError,
)

from app.config import settings
from app.core.db import _client_kwargs

logging.basicConfig(level=logging.INFO, format="%(levelname)-7s %(message)s")
log = logging.getLogger("dbtest")


def _masked(uri: str) -> str:
    """The URI with the password blanked, safe to print."""
    return re.sub(r"(mongodb(?:\+srv)?://[^:]+:)[^@]+(@)", r"\1***\2", uri)


async def main() -> int:
    uri = (settings.firestore_enterprise_uri or "").strip()

    if not uri or uri == "FILL_ME":
        log.error("FIRESTORE_ENTERPRISE_URI is not set in the environment or .env.")
        return 2

    kwargs = _client_kwargs()
    log.info("uri        : %s", _masked(uri))
    log.info("database   : %s", settings.database_name)
    log.info(
        "timeouts   : select=%dms connect=%dms socket=%dms",
        kwargs.get("serverSelectionTimeoutMS"),
        kwargs.get("connectTimeoutMS"),
        kwargs.get("socketTimeoutMS"),
    )
    log.info("tls forced : %s", kwargs.get("tls", "from URI"))

    try:
        client = AsyncIOMotorClient(uri, **kwargs)
    except ConfigurationError as exc:
        # Raised at construction — a contradictory option, usually tls in both
        # the URI and the kwargs, or a malformed authMechanismProperties.
        log.error("ConfigurationError: the URI or its options are contradictory.")
        log.error("  %s", exc)
        return 1

    log.info("pinging… (fails fast, not the driver's 30s default)")
    try:
        await client.admin.command("ping")
    except ServerSelectionTimeoutError as exc:
        log.error("ServerSelectionTimeoutError: no server answered in time.")
        log.error("  The host is wrong, the port is closed, or a firewall is in the way.")
        log.error("  %s", str(exc)[:300])
        return 1
    except OperationFailure as exc:
        # The server answered and rejected us — auth almost always.
        log.error("OperationFailure (code %s): the server refused the connection.", exc.code)
        if exc.code == 18 or "auth" in str(exc).lower():
            log.error("  Authentication failed — check the username and password in the URI.")
        else:
            log.error("  %s", str(exc)[:300])
        return 1
    except Exception as exc:
        log.error("%s: %s", type(exc).__name__, str(exc)[:300])
        return 1
    finally:
        client.close()

    log.info("-" * 56)
    log.info("OK — the database answered a ping. Connection is healthy.")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
