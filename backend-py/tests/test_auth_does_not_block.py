"""Verifying a sign-in never freezes the server.

The live failure: once the service-account key was found, every signed-in
request made synchronous network calls to Google on the one event loop the
single-worker instance has. While those waited, nothing else was answered — the
platform's health check included — so the platform restarted the service over
and over, and the site showed network errors.
"""

from __future__ import annotations

import asyncio
import time

import firebase_admin
import pytest
from fastapi import HTTPException

from app import firebase
from app.config import settings
from app.core import auth


def slow_verify(seconds: float):
    def verify(_token: str) -> dict[str, str]:
        time.sleep(seconds)  # a synchronous network call, as the SDK makes
        return {"uid": "usr_slow", "email": "slow@example.com", "name": "Slow"}

    return verify


@pytest.mark.usefixtures("mongo_db")
async def test_other_requests_keep_being_answered_during_verification(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(auth, "verify_google_token", slow_verify(0.6))

    ticks = 0

    async def health_checks() -> None:
        nonlocal ticks
        for _ in range(10):
            await asyncio.sleep(0.05)
            ticks += 1

    user, _ = await asyncio.gather(auth.current_user("Bearer a-token"), health_checks())

    assert user.uid == "usr_slow"
    assert ticks == 10, "the event loop was blocked while the token was verified"


async def test_a_verification_that_hangs_gives_up(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(auth, "verify_google_token", slow_verify(1.5))
    monkeypatch.setattr(settings, "auth_verify_timeout_s", 0.2)

    started = time.perf_counter()
    with pytest.raises(HTTPException) as caught:
        await auth.current_user("Bearer a-token")

    assert caught.value.status_code == 401
    assert time.perf_counter() - started < 1.0, "the request waited out the whole hang"


def test_the_revocation_lookup_is_off_unless_asked_for(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(auth, "has_service_credential", lambda: True)
    try:
        monkeypatch.setattr(settings, "firebase_check_revoked", False)
        auth._revocation_checked.cache_clear()
        assert auth._revocation_checked() is False

        monkeypatch.setattr(settings, "firebase_check_revoked", True)
        auth._revocation_checked.cache_clear()
        assert auth._revocation_checked() is True
    finally:
        auth._revocation_checked.cache_clear()


def test_firebase_network_calls_are_bounded(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(firebase, "SECRET_DIRS", (tmp_path,))
    monkeypatch.setattr(settings, "firebase_credentials_file", "")
    monkeypatch.setattr(firebase_admin, "_apps", {})

    captured: dict = {}

    def fake_initialize(*_args, options=None, **_kwargs):
        captured.update(options or {})
        return "app"

    monkeypatch.setattr(firebase_admin, "initialize_app", fake_initialize)
    firebase._app.cache_clear()
    try:
        firebase._app()
    finally:
        firebase._app.cache_clear()

    assert captured.get("httpTimeout") == settings.firebase_http_timeout_s
    assert settings.firebase_http_timeout_s <= 15
