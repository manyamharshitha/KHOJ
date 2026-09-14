"""Sign-in is verified without credentials, so a missing key file cannot break it.

Reproduced before the fix: with the key file not found and no Google
"application default credentials" — exactly Render — every token was rejected
with DefaultCredentialsError, and every signed-in customer was saved as
anonymous. Their history was empty because none of their searches had an owner.
"""

from __future__ import annotations

import base64
import json
import time

import pytest
from fastapi import HTTPException

from app.config import settings
from app.core import auth

PROJECT = "khoj-cd80b"


@pytest.fixture(autouse=True)
def _project(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(settings, "firebase_project_id", PROJECT)
    monkeypatch.setattr(settings, "firebase_check_revoked", False)
    auth._revocation_checked.cache_clear()
    yield
    auth._revocation_checked.cache_clear()


def google_says(claims: dict | None = None, error: Exception | None = None):
    def verify(token, request, audience=None, **_kwargs):
        assert audience == PROJECT, "the audience must be this project"
        if error:
            raise error
        return dict(claims)

    return verify


def the_admin_sdk_must_not_be_used():
    raise AssertionError("the Admin SDK (and its credentials) were used to verify a sign-in")


def test_a_valid_token_verifies_without_the_admin_sdk(monkeypatch: pytest.MonkeyPatch) -> None:
    """The live case: no key file, no default credentials, sign-in still works."""
    from google.oauth2 import id_token

    monkeypatch.setattr(auth, "_app", the_admin_sdk_must_not_be_used)
    monkeypatch.setattr(
        id_token,
        "verify_firebase_token",
        google_says({"iss": f"https://securetoken.google.com/{PROJECT}", "aud": PROJECT, "sub": "uid_123", "email": "a@b.c"}),
    )

    claims = auth.verify_google_token("header.payload.signature")

    assert claims["uid"] == "uid_123"
    assert claims["email"] == "a@b.c"


def test_a_token_from_another_project_is_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    from google.oauth2 import id_token

    monkeypatch.setattr(
        id_token,
        "verify_firebase_token",
        google_says({"iss": "https://securetoken.google.com/someone-else", "aud": PROJECT, "sub": "uid_1"}),
    )
    with pytest.raises(HTTPException) as caught:
        auth.verify_google_token("header.payload.signature")
    assert caught.value.status_code == 401


def test_an_expired_token_says_so(monkeypatch: pytest.MonkeyPatch) -> None:
    from google.oauth2 import id_token

    monkeypatch.setattr(id_token, "verify_firebase_token", google_says(error=ValueError("Token expired, 1 < 2")))
    with pytest.raises(HTTPException) as caught:
        auth.verify_google_token("header.payload.signature")
    assert "expired" in caught.value.detail


def test_no_project_id_is_reported_as_configuration(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "firebase_project_id", "")
    with pytest.raises(HTTPException) as caught:
        auth.verify_google_token("header.payload.signature")
    assert "not configured" in caught.value.detail


@pytest.mark.live
def test_a_forged_token_fails_on_its_key_not_on_missing_credentials(monkeypatch: pytest.MonkeyPatch) -> None:
    """Against Google's real certificates: the failure is about the token itself."""

    def b64(obj: dict) -> str:
        return base64.urlsafe_b64encode(json.dumps(obj).encode()).rstrip(b"=").decode()

    now = int(time.time())
    forged = ".".join(
        [
            b64({"alg": "RS256", "kid": "not-a-real-key", "typ": "JWT"}),
            b64({"iss": f"https://securetoken.google.com/{PROJECT}", "aud": PROJECT, "sub": "x", "iat": now, "exp": now + 600}),
            "c2lnbmF0dXJl",
        ]
    )
    monkeypatch.setattr(auth, "_app", the_admin_sdk_must_not_be_used)

    with pytest.raises(HTTPException) as caught:
        auth.verify_google_token(forged)

    cause = caught.value.__cause__
    assert type(cause).__name__ != "DefaultCredentialsError"
    assert caught.value.status_code == 401
