"""Every response carries CORS headers, including the ones nobody planned.

A response without them is unreadable to the browser, which reports it as a
CORS failure whatever it actually was — so a 500, a validation error and a
crashed handler all reach the customer as "blocked by CORS policy" and send
whoever is debugging it after a CORS bug that does not exist.

The subtle one is the unhandled exception. FastAPI registers
``@app.exception_handler(Exception)`` on Starlette's ``ServerErrorMiddleware``,
which sits *outside* every middleware the app adds — including CORS. The single
response most in need of a CORS header was being produced above the layer that
attaches it.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.main import app

ORIGIN = "https://khoj-beta.vercel.app"


@pytest.fixture
def client() -> TestClient:
    # raise_server_exceptions=False so the 500 is returned as a response rather
    # than re-raised into the test, which is what a browser would receive.
    return TestClient(app, raise_server_exceptions=False)


def test_a_known_origin_is_allowed(client: TestClient) -> None:
    response = client.options(
        "/api/search",
        headers={
            "Origin": ORIGIN,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "authorization,content-type",
        },
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == ORIGIN


def test_a_vercel_preview_deployment_is_allowed(client: TestClient) -> None:
    """Preview URLs are generated per deployment and cannot be listed ahead."""
    preview = "https://khoj-beta-git-feature-xyz.vercel.app"
    response = client.options(
        "/api/search",
        headers={"Origin": preview, "Access-Control-Request-Method": "POST"},
    )
    assert response.headers.get("access-control-allow-origin") == preview


def test_a_foreign_origin_is_refused(client: TestClient) -> None:
    """The regex is anchored, so this must not slip through."""
    response = client.options(
        "/api/search",
        headers={
            "Origin": "https://evil.example.com",
            "Access-Control-Request-Method": "POST",
        },
    )
    assert response.headers.get("access-control-allow-origin") != "https://evil.example.com"


def test_a_lookalike_origin_is_refused(client: TestClient) -> None:
    """`https://evil.com/x.vercel.app` must not match an unanchored pattern."""
    for origin in (
        "https://evil.com/khoj-beta.vercel.app",
        "https://khoj-beta.vercel.app.evil.com",
        "http://khoj-beta.vercel.app",
    ):
        response = client.options(
            "/api/search",
            headers={"Origin": origin, "Access-Control-Request-Method": "POST"},
        )
        assert response.headers.get("access-control-allow-origin") != origin, origin


def test_credentials_are_allowed_without_a_wildcard(client: TestClient) -> None:
    """The two are only legal together when the origin is echoed explicitly."""
    response = client.options(
        "/api/search",
        headers={"Origin": ORIGIN, "Access-Control-Request-Method": "POST"},
    )
    assert response.headers.get("access-control-allow-credentials") == "true"
    assert response.headers.get("access-control-allow-origin") != "*"


def test_a_404_still_carries_cors_headers(client: TestClient) -> None:
    response = client.get("/api/no-such-route", headers={"Origin": ORIGIN})
    assert response.status_code == 404
    assert response.headers["access-control-allow-origin"] == ORIGIN


def test_an_unhandled_exception_still_carries_cors_headers(client: TestClient) -> None:
    """The gap this middleware exists to close."""

    @app.get("/api/_boom_for_tests")
    async def boom() -> None:
        raise RuntimeError("deliberate")

    response = client.get("/api/_boom_for_tests", headers={"Origin": ORIGIN})

    assert response.status_code == 500
    assert response.headers.get("access-control-allow-origin") == ORIGIN, (
        "a 500 without CORS headers is reported by the browser as a CORS error, "
        "which is how a server crash gets mistaken for a CORS misconfiguration"
    )
    # And never a stack trace.
    assert "deliberate" not in response.text


def test_configured_origins_are_normalised() -> None:
    """A trailing slash matches no Origin header a browser will ever send."""
    assert all(not o.endswith("/") for o in settings.origins)
