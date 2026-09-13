"""Live video, proved against the real LiveKit server and the real database.

    python -m pytest tests/test_live_video_real.py -v -m live

Separate from `test_live_video.py`, and the distinction is the point of the
file. Those tests decode a JWT and compare strings; every one of them passes
against a LiveKit account that does not exist, because they check that the code
says what it was meant to say. These connect, publish frames, and read the
result back out of the database — they check that it *works*.

Excluded from the default run by the `live` marker, so `pytest tests` stays
offline and deterministic. That exclusion is a real cost: it means the tests
that would catch a broken integration are the ones nobody runs by habit. Run
them before shipping anything that touches verification.

Needs:

    pip install -e ".[live-tests]"
    LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET in .env
    a reachable database
"""

from __future__ import annotations

import asyncio

import pytest

from app.config import settings
from app.models import GeoPoint, SiteVisit, SiteVisitStatus, utcnow
from app.services.live_video import broker_token, room_name

pytestmark = [
    pytest.mark.live,
    pytest.mark.anyio,
    pytest.mark.skipif(not settings.livekit_ready, reason="LiveKit is not configured"),
]

FRAME_W, FRAME_H = 320, 240


def _green_frame():
    """One frame of solid colour, standing in for a camera."""
    import numpy as np

    buf = np.zeros((FRAME_H, FRAME_W, 4), dtype=np.uint8)
    buf[:, :, 1] = 200
    return buf.tobytes()


async def _publish_for(room, seconds: float = 0.7):
    """Join is not enough — publish and push frames, like a phone does."""
    from livekit import rtc

    source = rtc.VideoSource(FRAME_W, FRAME_H)
    track = rtc.LocalVideoTrack.create_video_track("camera", source)
    publication = await room.local_participant.publish_track(
        track, rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_CAMERA)
    )

    frame = _green_frame()
    deadline = asyncio.get_running_loop().time() + seconds
    while asyncio.get_running_loop().time() < deadline:
        source.capture_frame(
            rtc.VideoFrame(FRAME_W, FRAME_H, rtc.VideoBufferType.RGBA, frame)
        )
        await asyncio.sleep(1 / 15)
    return publication


# --------------------------------------------------------------------------
# the credentials and the server
# --------------------------------------------------------------------------


async def test_the_configured_credentials_are_accepted() -> None:
    """Before anything else: does LiveKit know who we are?

    A wrong secret fails here with a clear message rather than as a mysterious
    connection failure inside a broker's phone.
    """
    from livekit import api

    client = api.LiveKitAPI(
        url=settings.livekit_url,
        api_key=settings.livekit_api_key,
        api_secret=settings.livekit_api_secret,
    )
    try:
        rooms = await client.room.list_rooms(api.ListRoomsRequest())
        assert rooms is not None
    finally:
        await client.aclose()


# --------------------------------------------------------------------------
# the token our code mints
# --------------------------------------------------------------------------


async def test_our_token_actually_joins_and_publishes() -> None:
    """The claim the whole feature rests on.

    `test_live_video.py` asserts the token *says* it may publish to this room.
    This one hands it to LiveKit and finds out. A grant the server rejects
    looks identical in a unit test and fails in a broker's hand.
    """
    from livekit import rtc

    visit_id = "vis_pytest_join"
    session = broker_token(visit_id)
    room = rtc.Room()

    try:
        await asyncio.wait_for(room.connect(session.url, session.token), timeout=30)

        assert room.local_participant.identity == f"broker-{visit_id}"
        assert room.name == room_name(visit_id)

        publication = await _publish_for(room)
        assert publication.sid, "the track was never published"
    finally:
        await room.disconnect()


async def test_a_token_lands_in_its_own_visits_room_and_no_other() -> None:
    """The SMS link is unauthenticated, so the room grant is the whole boundary.

    Asserted as a positive, because there is no negative to catch: LiveKit
    derives the room from the token rather than taking one from the caller, so
    a broker cannot ask for somebody else's room — there is nowhere to put the
    request. What can go wrong is the grant being minted wrong, and that shows
    up as landing in the wrong room, which is what this checks.
    """
    from livekit import rtc

    mine, theirs = "vis_pytest_a", "vis_pytest_b"
    session = broker_token(mine)
    room = rtc.Room()

    try:
        await asyncio.wait_for(room.connect(session.url, session.token), timeout=30)

        assert room.name == room_name(mine)
        assert room.name != room_name(theirs), "a token reached another visit's room"

        # And it cannot watch: the grant is publish-only, so nobody else's
        # camera is subscribable even from inside a shared room.
        assert room.remote_participants == {}
    finally:
        await room.disconnect()


# --------------------------------------------------------------------------
# the endpoint, the database, and the GPS check
# --------------------------------------------------------------------------


@pytest.fixture
async def a_stored_visit():
    """A real visit in the real database, removed afterwards."""
    from app.core.db import connect, disconnect, get_db
    from app.repositories import SITE_VISITS, issue_visit_token, save_site_visit

    await connect()
    visit = SiteVisit(
        id="vis_pytest_e2e",
        listing_id="lst_pytest",
        requested_by="usr_pytest",
        broker_phone="+919000000099",
        scheduled_for=utcnow(),
        expected_point=GeoPoint(lat=12.9716, lng=77.5946),  # Bangalore
        property_address="pytest, Yelahanka",
    )
    await save_site_visit(visit)
    token = await issue_visit_token(visit.id)
    try:
        yield visit, token
    finally:
        await get_db()[SITE_VISITS].delete_one({"_id": visit.id})
        await disconnect()


async def test_the_endpoint_opens_a_room_a_broker_can_really_join(a_stored_visit) -> None:
    """The whole chain: link -> endpoint -> LiveKit -> published video -> db.

    Every hop here failed for me at least once while building this, and none of
    those failures were visible to a unit test.
    """
    import httpx
    from livekit import rtc

    from app.repositories import get_site_visit

    visit, token = a_stored_visit
    base = "http://127.0.0.1:8010"

    async with httpx.AsyncClient(timeout=30) as client:
        try:
            started = await client.post(f"{base}/api/visits/token/{token}/live")
        except httpx.HTTPError:
            pytest.skip("no backend on :8010 — start uvicorn to run this")

        assert started.status_code == 200, started.text
        body = started.json()
        assert body["room"] == room_name(visit.id)
        assert body["url"] and body["token"]

        # The fix is reported while streaming, which is the claim being made.
        located = await client.post(
            f"{base}/api/visits/token/{token}/location",
            params={"lat": 12.9716, "lng": 77.5946},
        )
        assert located.status_code == 200
        assert located.json()["within_range"] is True

    room = rtc.Room()
    try:
        await asyncio.wait_for(room.connect(body["url"], body["token"]), timeout=30)
        publication = await _publish_for(room)
        assert publication.sid
    finally:
        await room.disconnect()

    stored = await get_site_visit(visit.id)
    assert stored is not None
    assert stored.status is SiteVisitStatus.STREAMING
    assert stored.distance_m is not None and stored.distance_m < 5


async def test_a_fix_far_from_the_property_is_reported_as_out_of_range(
    a_stored_visit,
) -> None:
    """Told to the broker while they are still there.

    Better they move outside for a better fix than finish a stream that was
    never going to pass.
    """
    import httpx

    _visit, token = a_stored_visit

    async with httpx.AsyncClient(timeout=30) as client:
        try:
            response = await client.post(
                "http://127.0.0.1:8010/api/visits/token/%s/location" % token,
                params={"lat": 13.0827, "lng": 80.2707},  # Chennai
            )
        except httpx.HTTPError:
            pytest.skip("no backend on :8010 — start uvicorn to run this")

    assert response.status_code == 200
    body = response.json()
    assert body["within_range"] is False
    assert body["distance_m"] > 100_000


# --------------------------------------------------------------------------
# the webhook — the only thing that ever writes "verified"
# --------------------------------------------------------------------------


def _signed(payload: dict) -> tuple[str, str]:
    """A webhook body and an Authorization header LiveKit's receiver accepts.

    Built the way LiveKit builds them: a JWT whose `sha256` claim is the digest
    of the body, signed with the API secret. Producing a genuine signature here
    is what makes these tests worth anything — a mock receiver would pass just
    as happily on an endpoint that checked nothing.
    """
    import base64
    import hashlib
    import json
    import time

    import jwt

    body = json.dumps(payload)
    digest = base64.b64encode(hashlib.sha256(body.encode()).digest()).decode()
    now = int(time.time())
    token = jwt.encode(
        {
            "iss": settings.livekit_api_key,
            "exp": now + 300,
            "nbf": now - 5,
            "sha256": digest,
        },
        settings.livekit_api_secret,
        algorithm="HS256",
    )
    return body, token


async def _post_webhook(body: str, auth: str | None):
    import httpx

    headers = {"Content-Type": "application/json"}
    if auth is not None:
        headers["Authorization"] = auth
    async with httpx.AsyncClient(timeout=30) as client:
        try:
            return await client.post(
                "http://127.0.0.1:8010/api/visits/webhook/livekit",
                content=body,
                headers=headers,
            )
        except httpx.HTTPError:
            pytest.skip("no backend on :8010 — start uvicorn to run this")


async def test_an_unsigned_webhook_cannot_verify_a_property() -> None:
    """This endpoint is the only thing that writes "verified".

    Unauthenticated, it is a public API for marking any property in the
    database as verified by posting a JSON body.
    """
    body, _ = _signed({"event": "egress_ended", "room": {"name": "visit-anything"}})
    response = await _post_webhook(body, None)
    assert response.status_code == 401


async def test_a_forged_signature_cannot_verify_a_property() -> None:
    body, _ = _signed({"event": "egress_ended", "room": {"name": "visit-anything"}})
    response = await _post_webhook(body, "Bearer forged")
    assert response.status_code == 401


async def test_a_room_belonging_to_another_project_is_ignored() -> None:
    """Other rooms may share the LiveKit project. Not ours, and not an error."""
    body, auth = _signed({"event": "egress_ended", "room": {"name": "someone-elses-room"}})
    response = await _post_webhook(body, auth)

    assert response.status_code == 200
    assert "ignored" in response.json()


async def test_a_signed_recording_marks_the_visit_verified(a_stored_visit) -> None:
    """The last link in the chain, and the one no other test covers.

    Everything else ends at `streaming`. Nothing reaches `verified` until
    LiveKit posts here, so a broken webhook means a feature that appears to
    work and never produces a verified property.
    """
    from app.repositories import get_site_visit, update_site_visit

    visit, _token = a_stored_visit

    # What a finished live session leaves behind: streaming, with a good fix.
    await update_site_visit(
        visit.id,
        status=SiteVisitStatus.STREAMING.value,
        captured_point=GeoPoint(lat=12.9716, lng=77.5946).to_document(),
    )

    body, auth = _signed(
        {
            "event": "egress_ended",
            "room": {"name": room_name(visit.id)},
            "egressInfo": {
                "egressId": "EG_pytest",
                "fileResults": [
                    {
                        "location": "gs://bucket/site-visits/pytest.mp4",
                        "duration": 42_000_000_000,  # nanoseconds
                    }
                ],
            },
        }
    )
    response = await _post_webhook(body, auth)
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "verified"

    stored = await get_site_visit(visit.id)
    assert stored.is_verified
    assert stored.video_url == "gs://bucket/site-visits/pytest.mp4"
    # Nanoseconds in the payload, seconds in the model.
    assert stored.video_seconds == pytest.approx(42.0)


async def test_a_recording_from_the_wrong_place_is_flagged_not_verified(
    a_stored_visit,
) -> None:
    """A video did arrive. It just did not come from the property.

    The distinction between "we have video" and "we checked it" is the entire
    product, so this must never quietly pass.
    """
    from app.repositories import get_site_visit, update_site_visit

    visit, _token = a_stored_visit
    await update_site_visit(
        visit.id,
        status=SiteVisitStatus.STREAMING.value,
        captured_point=GeoPoint(lat=13.0827, lng=80.2707).to_document(),  # Chennai
    )

    body, auth = _signed(
        {
            "event": "egress_ended",
            "room": {"name": room_name(visit.id)},
            "egressInfo": {"egressId": "EG_pytest", "fileResults": []},
        }
    )
    response = await _post_webhook(body, auth)

    assert response.status_code == 200
    assert response.json()["status"] == "gps_mismatch"
    assert not (await get_site_visit(visit.id)).is_verified


async def test_an_already_verified_visit_refuses_a_second_session(
    a_stored_visit,
) -> None:
    """One link, one verification. A second would overwrite the evidence."""
    import httpx

    from app.repositories import update_site_visit

    visit, token = a_stored_visit
    await update_site_visit(visit.id, status=SiteVisitStatus.VERIFIED.value)

    async with httpx.AsyncClient(timeout=30) as client:
        try:
            response = await client.post(
                f"http://127.0.0.1:8010/api/visits/token/{token}/live"
            )
        except httpx.HTTPError:
            pytest.skip("no backend on :8010 — start uvicorn to run this")

    assert response.status_code == 409
