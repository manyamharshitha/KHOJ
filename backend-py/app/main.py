"""FastAPI application entrypoint.

Run with::

    uvicorn app.main:app --reload --port 8000
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import settings
from app.routes import auth as auth_routes, leads, search
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

    log.info(
        "khoj-py up · telephony=%s · llm=%s · auth=%s",
        settings.telephony_provider,
        settings.llm_provider,
        "required" if settings.auth_required else "open",
    )
    if settings.telephony_provider == "mock":
        log.warning("telephony is MOCK — calls are simulated, nothing is dialled")

    yield
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


@app.get("/api/health", tags=["meta"])
async def health() -> dict[str, object]:
    """Liveness, and which providers are actually wired.

    Surfaced so nobody demos the mock dialer believing it is placing real calls.
    """
    from app.llm.client import llm_available

    return {
        "ok": True,
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
