"""The verification link a broker receives opens the real site, never localhost.

Seen live: PUBLIC_BASE_URL was never set on the server, so every link sent to a
broker was http://localhost:5173/verify/<token> — it opened on the laptop that
happened to be running the dev server and on no phone anywhere.
"""

from __future__ import annotations

import pytest
from starlette.requests import Request

from app import repositories as repo
from app.config import settings
from app.core.sms import SmsResult
from app.models import SiteVisit, UserProfile, utcnow

LIVE = "https://khoj-beta.vercel.app"


def a_request(origin: str | None) -> Request:
    headers = [(b"origin", origin.encode())] if origin else []
    return Request({"type": "http", "method": "POST", "path": "/", "headers": headers})


@pytest.fixture
def unset_public_url(monkeypatch: pytest.MonkeyPatch) -> None:
    """The live server: PUBLIC_BASE_URL left at its localhost default."""
    monkeypatch.setattr(settings, "public_base_url", "http://localhost:5173")
    monkeypatch.setattr(settings, "frontend_origins", "http://localhost:5173")


def test_a_real_public_base_url_is_used_as_set(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "public_base_url", "https://khoj.example/")
    assert settings.app_url(LIVE) == "https://khoj.example"


@pytest.mark.usefixtures("unset_public_url")
def test_unset_it_uses_the_site_the_request_came_from() -> None:
    assert settings.app_url(LIVE) == LIVE


@pytest.mark.usefixtures("unset_public_url")
def test_an_origin_cors_would_refuse_is_not_trusted() -> None:
    assert settings.app_url("https://evil.example") == "http://localhost:5173"


def test_with_no_request_the_first_real_allowed_origin_is_used(monkeypatch: pytest.MonkeyPatch) -> None:
    """The background scheduler has no request to read an origin from."""
    monkeypatch.setattr(settings, "public_base_url", "http://localhost:5173")
    monkeypatch.setattr(settings, "frontend_origins", f"http://localhost:5173, {LIVE}/")
    assert settings.app_url() == LIVE


@pytest.mark.usefixtures("unset_public_url")
def test_on_a_laptop_localhost_is_still_right() -> None:
    assert settings.app_url("http://localhost:5173") == "http://localhost:5173"


@pytest.mark.usefixtures("mongo_db", "unset_public_url")
async def test_sending_returns_a_link_and_message_the_broker_can_open(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.routes import visits

    # No real message may leave a test, whatever this machine has configured.
    async def no_gateway(_to: str, _body: str) -> SmsResult:
        return SmsResult(False, reason="SMS is not configured on this server.")

    monkeypatch.setattr(visits, "send_sms", no_gateway)
    monkeypatch.setattr(visits, "sms_available", lambda: False)

    await repo.save_site_visit(
        SiteVisit(
            id="vis_link",
            listing_id="lst_link",
            requested_by="usr_link",
            broker_phone="+919000000077",
            scheduled_for=utcnow(),
        )
    )

    body = await visits.send_request("vis_link", user=UserProfile(uid="usr_link"), request=a_request(LIVE))

    assert body["link"].startswith(f"{LIVE}/verify/")
    assert "localhost" not in body["whatsapp_url"]
    assert body["sent"] is False
    assert body["sms_configured"] is False, "the page needs this to offer WhatsApp as the normal path"
