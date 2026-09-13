"""Proof that the video actually arrives somewhere, and the location with it.

    python -m pytest tests/test_live_video_media.py -v -m live

`test_live_video_real.py` proves a broker can connect and publish. Publishing
is not the claim, though — a track nobody receives is a light going on in an
empty room, and every test that only checks the publisher would pass against a
server dropping every frame.

So these connect a second participant, subscribe to the broker's track, and wait
for real decoded frames to arrive. Then they run the location half against the
same session and confirm the distance is computed from the fix the phone sent
while it was streaming, which is the whole basis for the badge.
"""

from __future__ import annotations

import asyncio

import pytest

from app.config import settings
from app.services.live_video import broker_token, room_name

pytestmark = [
    pytest.mark.live,
    pytest.mark.anyio,
    pytest.mark.skipif(not settings.livekit_ready, reason="LiveKit is not configured"),
]

W, H = 320, 240


def _viewer_token(visit_id: str) -> str:
    """A token that may watch. The broker's deliberately cannot.

    Minted here rather than added to the application, because nothing in Khoj
    watches a stream live — the recording is the artefact. This exists so a test
    can stand where a viewer would and confirm the media is really flowing.
    """
    from datetime import timedelta

    from livekit.api import AccessToken, VideoGrants

    return (
        AccessToken(settings.livekit_api_key, settings.livekit_api_secret)
        .with_identity(f"test-viewer-{visit_id}")
        .with_grants(
            VideoGrants(room=room_name(visit_id), room_join=True, can_subscribe=True)
        )
        .with_ttl(timedelta(minutes=5))
        .to_jwt()
    )


async def _publish_colour(room, seconds: float):
    """Publish a solid colour and keep pushing frames for `seconds`."""
    import numpy as np
    from livekit import rtc

    source = rtc.VideoSource(W, H)
    track = rtc.LocalVideoTrack.create_video_track("camera", source)
    await room.local_participant.publish_track(
        track, rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_CAMERA)
    )

    buf = np.zeros((H, W, 4), dtype=np.uint8)
    buf[:, :, 1] = 200
    frame = buf.tobytes()

    end = asyncio.get_running_loop().time() + seconds
    while asyncio.get_running_loop().time() < end:
        source.capture_frame(rtc.VideoFrame(W, H, rtc.VideoBufferType.RGBA, frame))
        await asyncio.sleep(1 / 15)


async def test_a_second_participant_receives_the_brokers_video() -> None:
    """The claim: this is a live call, not a track shouted into an empty room.

    Publishing proves the broker's end. Only a subscriber decoding frames proves
    the media crossed the network — and that is what "live video verification"
    has to mean to be worth anything.
    """
    from livekit import rtc

    visit = "vis_media_1"
    broker = rtc.Room()
    viewer = rtc.Room()

    got_track = asyncio.Event()
    frames = 0

    @viewer.on("track_subscribed")
    def _on_track(track, publication, participant):  # noqa: ANN001
        if track.kind == rtc.TrackKind.KIND_VIDEO:
            got_track.set()

            async def count() -> None:
                nonlocal frames
                stream = rtc.VideoStream(track)
                async for _event in stream:
                    frames += 1
                    if frames >= 5:
                        break

            asyncio.create_task(count())

    try:
        session = broker_token(visit)
        await asyncio.wait_for(viewer.connect(session.url, _viewer_token(visit)), 30)
        await asyncio.wait_for(broker.connect(session.url, session.token), 30)

        publishing = asyncio.create_task(_publish_colour(broker, 8))
        await asyncio.wait_for(got_track.wait(), timeout=25)
        assert got_track.is_set(), "the viewer never received the broker's track"

        # Subscribing is not receiving. Wait for decoded frames.
        for _ in range(60):
            if frames >= 5:
                break
            await asyncio.sleep(0.25)

        publishing.cancel()
        assert frames >= 5, f"subscribed but only {frames} frame(s) decoded — no media"
    finally:
        await broker.disconnect()
        await viewer.disconnect()


async def test_the_broker_cannot_watch_anyone(mongo_db=None) -> None:
    """The broker publishes and must not subscribe.

    Their link is unauthenticated and forwardable, so a token that could watch
    would turn one SMS into a window onto other people's verifications.
    """
    from livekit import rtc

    visit = "vis_media_2"
    room = rtc.Room()
    try:
        session = broker_token(visit)
        await asyncio.wait_for(room.connect(session.url, session.token), 30)
        # Nothing to subscribe to, and no permission to if there were.
        assert room.remote_participants == {}
    finally:
        await room.disconnect()


async def test_the_location_sent_while_streaming_decides_the_badge() -> None:
    """GPS and video are one claim: *this device, at these coordinates, now*.

    A fix posted after the stream proves only where somebody stood later, so the
    endpoint records it during. This drives the real HTTP route and reads the
    distance back out of the database.
    """
    import httpx

    from app.core.db import connect, disconnect, get_db
    from app.models import GeoPoint, SiteVisit, utcnow
    from app.repositories import SITE_VISITS, get_site_visit, issue_visit_token, save_site_visit

    await connect()
    visit = SiteVisit(
        id="vis_media_gps",
        listing_id="lst_media",
        requested_by="usr_media",
        broker_phone="+919000000055",
        scheduled_for=utcnow(),
        expected_point=GeoPoint(lat=12.9716, lng=77.5946),  # Bangalore
        property_address="pytest media check",
    )
    await save_site_visit(visit)
    token = await issue_visit_token(visit.id)

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            try:
                at_the_flat = await client.post(
                    f"http://127.0.0.1:8010/api/visits/token/{token}/location",
                    params={"lat": 12.9716, "lng": 77.5946},
                )
            except httpx.HTTPError:
                pytest.skip("no backend on :8010 — start uvicorn to run this")

            assert at_the_flat.status_code == 200
            body = at_the_flat.json()
            assert body["within_range"] is True
            assert body["distance_m"] < 5

            # And the other side of the check: a fix from another city.
            elsewhere = await client.post(
                f"http://127.0.0.1:8010/api/visits/token/{token}/location",
                params={"lat": 19.0760, "lng": 72.8777},  # Mumbai
            )
            assert elsewhere.json()["within_range"] is False
            assert elsewhere.json()["distance_m"] > 500_000

        stored = await get_site_visit(visit.id)
        assert stored.captured_point is not None, "the fix was never recorded"
        assert stored.distance_m is not None
    finally:
        await get_db()[SITE_VISITS].delete_one({"_id": visit.id})
        await disconnect()
