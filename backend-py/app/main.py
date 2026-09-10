"""FastAPI application entrypoint.

Run with::

    uvicorn app.main:app --reload --port 8000
"""

from __future__ import annotations

import asyncio
import logging
from datetime import timedelta
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import settings
from app.core import scheduler
from app.core.db import DatabaseNotReady, connect, disconnect, get_db
from app.repositories import fail_orphaned_sessions
from app.core.indexes import ensure_indexes
from app.routes import auth as auth_routes
from app.routes import (
    admin,
    brokers,
    chat,
    leads,
    listings,
    negotiations,
    notifications,
    search,
    users,
    visits,
)
from app.telephony.persona import assert_compliance

logging.basicConfig(
    level=getattr(logging, settings.log_level.upper(), logging.INFO),
    format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
)
log = logging.getLogger("khoj")


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    """Boot checks that are better failed loudly than discovered mid-call."""
    assert_compliance()

    # The Motor client binds to the running event loop when it is constructed,
    # so it has to be built here rather than at import time — a client attached
    # to the wrong loop does not error, it simply hangs on every query.
    # A database that cannot be reached must not stop the process from starting.
    #
    # Raising here aborts uvicorn's startup, so it never binds $PORT — and a
    # platform that cannot open a socket reports "deploy failed" with no way to
    # curl the app and find out why. Starting degraded keeps the port bound and
    # the logs reachable; /health then answers 503, so the platform still knows
    # the instance is not fit to serve and a bad deploy does not go live.
    database_ready = False
    try:
        await connect()
        database_ready = True
    except DatabaseNotReady as exc:
        log.error("STARTUP DEGRADED - the database is unreachable: %s", exc)
        log.error("The API is listening, but every request that touches storage will fail.")
        log.error("Check FIRESTORE_ENTERPRISE_URI and DATABASE_NAME, then redeploy.")
    except Exception:  # noqa: BLE001 - never let an unexpected error stop the bind
        log.exception("STARTUP DEGRADED - the database could not be opened")

    if database_ready and settings.ensure_indexes_on_startup:
        try:
            await ensure_indexes(get_db())
        except Exception:  # noqa: BLE001 - an index is not worth failing a boot
            log.exception("indexes: could not be created; continuing without them")

    # Anything still marked as running cannot be: this process has just booted,
    # so whatever was doing it is gone. A worker killed mid-search — OOM from
    # Chromium, a deploy, a platform restart — runs no `except`, no `finally`
    # and no timeout, because all three are code. Without this the session stays
    # in `scraping` for ever and the customer watches a progress bar that will
    # never move.
    if database_ready:
        try:
            orphaned = await fail_orphaned_sessions(older_than=timedelta(minutes=15))
            if orphaned:
                log.warning(
                    "startup: failed %d search(es) left running by a previous worker",
                    orphaned,
                )
        except Exception:  # noqa: BLE001 - housekeeping must not stop a boot
            log.exception("startup: could not reap orphaned searches")

    log.info(
        "khoj-py up · db=%s(%s) · telephony=%s · llm=%s · auth=%s",
        settings.database_name,
        "connected" if database_ready else "UNREACHABLE",
        settings.telephony_provider,
        settings.llm_provider,
        "required" if settings.auth_required else "open",
    )
    if settings.telephony_provider == "mock":
        log.warning("telephony is MOCK — calls are simulated, nothing is dialled")

    # A browser signing people in and a server that cannot verify what it signs
    # them in with. Nothing errors: every request arrives with a token, fails
    # verification, and is quietly downgraded to anonymous. Sessions are then
    # written with no owner, so the dashboard and the search history — both
    # correctly scoped to a customer — are permanently empty, and completed work
    # is reachable only through whatever session id the browser still holds.
    #
    # Said at startup because the symptom appears nowhere near the cause.
    if not (settings.firebase_project_id or settings.firebase_credentials_file):
        log.warning(
            "FIREBASE IS NOT CONFIGURED — no project id and no credentials file. "
            "Signed-in requests will be accepted as ANONYMOUS and their sessions "
            "stored with no owner, which empties the dashboard and history. Set "
            "FIREBASE_PROJECT_ID, or mount the service account at "
            "FIREBASE_CREDENTIALS_FILE (currently %r).",
            settings.firebase_credentials_file or "<unset>",
        )

    # The site-visit scheduler. Only started when the database is up: with no
    # storage it would spin uselessly and log a failure every thirty seconds.
    visit_scheduler: asyncio.Task[None] | None = None
    if database_ready and settings.run_visit_scheduler:
        visit_scheduler = asyncio.create_task(scheduler.run_forever())

    try:
        yield
    finally:
        if visit_scheduler is not None:
            visit_scheduler.cancel()
            # Awaited rather than abandoned, so shutdown does not race the
            # cancellation and leave a half-finished write behind.
            with suppress(asyncio.CancelledError):
                await visit_scheduler
        await disconnect()
        log.info("khoj-py shutting down")


app = FastAPI(
    title="Khoj",
    version="0.1.0",
    summary="Autonomous real-estate search and outbound verification calling.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_routes.router)
app.include_router(search.router)
app.include_router(leads.router)
app.include_router(chat.router)
app.include_router(listings.router)
app.include_router(users.router)
app.include_router(brokers.router)
app.include_router(admin.router)
app.include_router(visits.router)
app.include_router(negotiations.router)
app.include_router(notifications.router)


@app.get("/", tags=["meta"])
async def root() -> dict[str, object]:
    """A signpost.

    Every real route lives under /api, so hitting the bare domain used to return
    a bare 404 that looks like a broken deployment. It is not — but a JSON body
    saying so is cheaper than the confusion.
    """
    return {
        "service": "khoj-api",
        "status": "ok",
        "docs": "/docs",
        "health": "/api/health",
    }


@app.get("/health", tags=["meta"])
async def health_root() -> JSONResponse:
    """Deployment health, including whether the database actually answers.

    Separate from ``/api/health`` and deliberately blunt: it returns 503 when
    the database is unreachable, so a platform health check fails the deploy
    instead of routing traffic to an instance that will 500 on every write.
    That is the failure mode that made the lead form look like a network error.
    """
    from app.core.db import ping_diagnostic

    connected, error = await ping_diagnostic()
    body = {
        "status": "ok" if connected else "degraded",
        "database": settings.database_name,
        "database_connected": connected,
    }
    if error:
        body["error"] = error
    return JSONResponse(
        body, status_code=200 if connected else status.HTTP_503_SERVICE_UNAVAILABLE
    )


@app.get("/api/health", tags=["meta"])
async def health() -> dict[str, object]:
    """Liveness, and which providers are actually wired.

    Surfaced so nobody demos the mock dialer believing it is placing real calls.
    """
    from app.core.db import ping
    from app.llm.client import llm_available

    return {
        "ok": True,
        # Reported separately from ``ok`` on purpose: the process can be alive
        # and answering while the database is unreachable, and that difference
        # is exactly what you want to see at 2am.
        "database": settings.database_name,
        "database_connected": await ping(),
        "telephony": settings.telephony_provider,
        "llm_provider": settings.llm_provider,
        "llm_configured": llm_available(),
        "extraction_model": settings.extraction_model,
        "calle_configured": bool(settings.calle_api_key),
        "max_sites": settings.max_sites_per_search,
        "max_concurrent_calls": settings.max_concurrent_calls,
        "call_windows_enforced": not settings.ignore_call_window,
    }


@app.exception_handler(Exception)
async def unhandled(_: object, exc: Exception) -> JSONResponse:
    """Never leak a stack trace to a customer."""
    log.exception("unhandled error", exc_info=exc)
    return JSONResponse(status_code=500, content={"detail": "Something went wrong on our side."})
