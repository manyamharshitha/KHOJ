"""Live video verification: rooms, tokens, the webhook, and the verdict.

The claim being made is physical — *somebody was standing in that property, at
that time, with a camera* — and every test here defends one of the things that
claim rests on. A join token that reaches the wrong room, a webhook anyone can
post to, or a verdict that differs between the live and upload paths would each
turn "Khoj Verified" into a badge that means nothing.

Nothing here touches the network or LiveKit. Run it with the rest:

    python -m pytest tests/test_live_video.py -v
"""

from __future__ import annotations

from datetime import timedelta

import pytest

from app.config import settings
from app.models import GeoPoint, SiteVisit, SiteVisitStatus, utcnow
from app.routes.visits import decide_outcome
from app.services import live_video


@pytest.fixture
def configured(monkeypatch: pytest.MonkeyPatch) -> None:
    """LiveKit credentials, so token minting can be exercised offline."""
    monkeypatch.setattr(settings, "livekit_url", "wss://test.livekit.cloud")
    monkeypatch.setattr(settings, "livekit_api_key", "APItestkey")
    monkeypatch.setattr(settings, "livekit_api_secret", "a" * 40)


def a_visit(**over) -> SiteVisit:
    """A visit scheduled for now, at a known point."""
    fields = dict(
        id="vis_test1",
        listing_id="lst_1",
        requested_by="usr_1",
        broker_phone="+919000000001",
        scheduled_for=utcnow(),
        expected_point=GeoPoint(lat=12.9716, lng=77.5946),  # Bangalore
        property_address="2 BHK, Yelahanka",
    )
    fields.update(over)
    return SiteVisit(**fields)


# --------------------------------------------------------------------------
# rooms
# --------------------------------------------------------------------------


def test_a_room_maps_back_to_its_visit() -> None:
    """The webhook has only the room name to work from."""
    room = live_video.room_name("vis_abc")
    assert live_video.visit_id_from_room(room) == "vis_abc"


def test_a_room_belonging_to_something_else_is_ignored() -> None:
    """Other rooms may share the LiveKit project. They are not ours to act on."""
    assert live_video.visit_id_from_room("some-other-room") is None
    assert live_video.visit_id_from_room("") is None


def test_the_room_name_is_derived_from_the_visit_and_so_is_stable() -> None:
    """A broker who reloads rejoins rather than opening a second room."""
    assert live_video.room_name("vis_abc") == live_video.room_name("vis_abc")
    assert live_video.room_name("vis_abc") != live_video.room_name("vis_xyz")


# --------------------------------------------------------------------------
# join tokens
# --------------------------------------------------------------------------


def test_no_credentials_means_no_session(monkeypatch: pytest.MonkeyPatch) -> None:
    """Refused clearly, so the endpoint can answer 503 and offer the upload."""
    monkeypatch.setattr(settings, "livekit_url", "")
    with pytest.raises(live_video.LiveVideoUnavailable):
        live_video.broker_token("vis_abc")


def test_a_join_token_is_minted_for_the_visits_own_room(configured: None) -> None:
    session = live_video.broker_token("vis_abc")

    assert session.room == "visit-vis_abc"
    assert session.url == "wss://test.livekit.cloud"
    assert session.token and session.token.count(".") == 2, "not a JWT"


def test_the_token_grants_one_room_and_publish_only(configured: None) -> None:
    """The link is unauthenticated, so the token is the entire boundary.

    A token that could subscribe would let whoever holds one SMS watch another
    broker's verification; one without a room restriction would let them join
    any room on the project.
    """
    import base64
    import json

    session = live_video.broker_token("vis_abc")
    payload = session.token.split(".")[1]
    payload += "=" * (-len(payload) % 4)
    claims = json.loads(base64.urlsafe_b64decode(payload))
    video = claims["video"]

    assert video["room"] == "visit-vis_abc"
    assert video["roomJoin"] is True
    assert video["canPublish"] is True
    assert video.get("canSubscribe") is not True, "the broker must not watch others"


def test_the_token_expires(configured: None, monkeypatch: pytest.MonkeyPatch) -> None:
    """It is minted when they open the link, standing in the property.

    A token good for hours is one that can be forwarded to somebody who is not.
    """
    import base64
    import json
    import time

    monkeypatch.setattr(settings, "livekit_token_ttl_minutes", 20)
    session = live_video.broker_token("vis_abc")

    payload = session.token.split(".")[1]
    payload += "=" * (-len(payload) % 4)
    claims = json.loads(base64.urlsafe_b64decode(payload))

    # Measured against the clock, not against an `iat` claim — the SDK emits
    # `nbf` and `exp` but no issued-at, and asserting on a field it does not
    # write tests the library rather than the expiry.
    assert "exp" in claims
    remaining = claims["exp"] - time.time()
    assert 0 < remaining <= 21 * 60, f"{remaining / 60:.1f} minutes is not a short-lived token"


# --------------------------------------------------------------------------
# recording
# --------------------------------------------------------------------------


async def test_recording_off_is_not_an_error(monkeypatch: pytest.MonkeyPatch) -> None:
    """A session that streams and is not recorded still proves presence."""
    monkeypatch.setattr(settings, "livekit_record", False)
    assert await live_video.start_recording("vis_abc") is None


async def test_recording_on_with_no_bucket_does_not_fail_the_visit(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Losing the artefact is bad. Losing the verification too is worse."""
    monkeypatch.setattr(settings, "livekit_record", True)
    monkeypatch.setattr(settings, "livekit_recording_bucket", "")
    assert await live_video.start_recording("vis_abc") is None


# --------------------------------------------------------------------------
# the webhook
# --------------------------------------------------------------------------


def test_an_unsigned_webhook_is_refused(configured: None) -> None:
    """This endpoint moves a visit to verified.

    Unauthenticated, it would let anyone mark any property verified by posting
    a JSON body.
    """
    with pytest.raises(ValueError):
        live_video.verify_webhook(b'{"event":"egress_ended"}', None)


def test_a_forged_signature_is_refused(configured: None) -> None:
    with pytest.raises(Exception):
        live_video.verify_webhook(b'{"event":"egress_ended"}', "Bearer not-a-real-token")


# --------------------------------------------------------------------------
# the verdict — shared by the live and upload paths
# --------------------------------------------------------------------------


def test_being_at_the_address_verifies() -> None:
    visit = a_visit()
    here = GeoPoint(lat=12.9716, lng=77.5946)

    outcome, distance = decide_outcome(visit, here, utcnow())

    assert outcome is SiteVisitStatus.VERIFIED
    assert distance is not None and distance < 5


def test_being_across_the_city_does_not() -> None:
    visit = a_visit()
    elsewhere = GeoPoint(lat=13.0827, lng=80.2707)  # Chennai

    outcome, distance = decide_outcome(visit, elsewhere, utcnow())

    assert outcome is SiteVisitStatus.GPS_MISMATCH
    assert distance is not None and distance > 100_000


def test_no_location_is_received_not_verified() -> None:
    """No phone GPS, or an address that could not be geocoded.

    The distinction between "we have video" and "we checked it" is the whole
    product, so an unknown location must never quietly pass.
    """
    outcome, distance = decide_outcome(a_visit(), None, utcnow())

    assert outcome is SiteVisitStatus.VIDEO_RECEIVED
    assert distance is None


def test_arriving_after_the_window_is_reported_as_late_even_at_the_address() -> None:
    """Lateness is a fact; a GPS reading is a judgement. The fact wins."""
    visit = a_visit()
    late = utcnow() + timedelta(minutes=settings.site_visit_grace_minutes + 5)

    outcome, _ = decide_outcome(visit, GeoPoint(lat=12.9716, lng=77.5946), late)

    assert outcome is SiteVisitStatus.LATE_SUBMISSION


def test_a_fix_just_inside_the_radius_passes() -> None:
    """GPS indoors is tens of metres out, which the radius exists to absorb."""
    visit = a_visit()
    # ~100m north of the expected point; the default radius is 150m.
    nearby = GeoPoint(lat=12.9716 + 0.0009, lng=77.5946)

    outcome, distance = decide_outcome(visit, nearby, utcnow())

    assert distance is not None and distance < settings.site_visit_radius_m
    assert outcome is SiteVisitStatus.VERIFIED


def test_streaming_is_a_state_of_its_own() -> None:
    """A visit abandoned mid-stream reads differently from one never opened."""
    assert SiteVisitStatus.STREAMING.value == "streaming"
    assert SiteVisitStatus.STREAMING is not SiteVisitStatus.SMS_SENT
    assert not a_visit(status=SiteVisitStatus.STREAMING).is_verified


def test_only_an_explicit_pass_counts_as_verified() -> None:
    """The badge shown to a renter must mean one thing."""
    for status in SiteVisitStatus:
        visit = a_visit(status=status)
        assert visit.is_verified == (status is SiteVisitStatus.VERIFIED), status
