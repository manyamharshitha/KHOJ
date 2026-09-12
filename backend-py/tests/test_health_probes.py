"""Liveness must not fail because a dependency is slow.

``render.yaml`` points the platform health check at ``/health``. A failing
health check makes the platform stop routing to the instance and then restart
the service — so an endpoint that answered 503 whenever the database ping took
longer than three seconds could take the whole API down over a transient blip:
503 while out of rotation, 502 while restarting, and neither of those reaches
this application, so no CORS headers were attached and the browser reported the
outage as a CORS error.

Restarting a process does not repair an unreachable database. It removes the API
as well. So liveness reports only whether this process can answer, and
readiness — which nothing is allowed to restart the service over — reports the
database.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import app

ORIGIN = "https://khoj-beta.vercel.app"


@pytest.fixture
def client() -> TestClient:
    return TestClient(app, raise_server_exceptions=False)


def test_liveness_is_200_even_with_no_database(client: TestClient) -> None:
    """The regression that caused the outage. No database is connected here."""
    response = client.get("/health")

    assert response.status_code == 200, (
        "/health is the platform's liveness probe; a non-200 makes it stop "
        "routing and restart the service, which cannot fix a database"
    )
    assert response.json()["status"] == "ok"


def test_liveness_still_reports_the_database_truthfully(client: TestClient) -> None:
    """Honest in the body, without being able to cycle the service."""
    body = client.get("/health").json()

    assert body["database_connected"] is False
    assert "database" in body


def test_readiness_is_503_with_no_database(client: TestClient) -> None:
    """What /health used to be, kept where it cannot restart anything."""
    response = client.get("/health/ready")

    assert response.status_code == 503
    assert response.json()["status"] == "degraded"


def test_both_probes_carry_cors_headers(client: TestClient) -> None:
    """Including the 503 — a headerless response is reported as a CORS error."""
    for path in ("/health", "/health/ready"):
        response = client.get(path, headers={"Origin": ORIGIN})
        assert response.headers.get("access-control-allow-origin") == ORIGIN, path


def test_the_platform_probes_liveness_and_not_readiness() -> None:
    """The wiring is the whole point; a path change here recreates the outage."""
    from pathlib import Path

    render = Path(__file__).resolve().parents[2] / "render.yaml"
    if not render.is_file():  # pragma: no cover - only in a trimmed checkout
        pytest.skip("render.yaml is not present")

    text = render.read_text(encoding="utf-8")
    assert "healthCheckPath: /health\n" in text or "healthCheckPath: /health " in text, (
        "the platform health check must point at /health (liveness). Pointing it "
        "at /health/ready restores the restart loop this split was made to end."
    )
