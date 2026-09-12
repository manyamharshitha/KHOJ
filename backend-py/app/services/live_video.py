"""Live video verification: rooms, join tokens, and the recording.

The claim this exists to support is a physical one — *somebody was standing in
that property, at that time, with a camera* — and it is the reason a live
stream is used rather than an upload. A file can be recorded last year at a
different flat and sent today. A WebRTC session cannot: the broker is connected
in real time, from the device we are simultaneously reading a GPS fix from.

What it does not prove is worth being equally clear about. A determined person
can point a phone at a screen, and a rooted device can lie about its location.
"Khoj Verified" therefore means *someone was live at these coordinates at this
time*, which is a great deal more than a portal photograph and less than a
notarised fact.

The room name is the visit id, which makes it deterministic — a broker who
reloads the page rejoins rather than opening a second room — and traceable back
to the listing without a lookup table.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import timedelta

from app.config import settings

log = logging.getLogger(__name__)


class LiveVideoUnavailable(RuntimeError):
    """LiveKit is not configured, so no live session can be started."""


@dataclass(frozen=True, slots=True)
class LiveSession:
    """What the broker's browser needs to join."""

    room: str
    token: str
    url: str
    expires_in_minutes: int


def room_name(visit_id: str) -> str:
    return f"visit-{visit_id}"


def visit_id_from_room(room: str) -> str | None:
    """The inverse, for the webhook. None when the room is not one of ours."""
    return room[len("visit-") :] if room.startswith("visit-") else None


def broker_token(visit_id: str, *, display_name: str | None = None) -> LiveSession:
    """A single-room join token for the broker.

    Deliberately narrow. The grant allows publishing into one named room and
    nothing else: not subscribing to other participants, not listing rooms, not
    joining any other. Whoever holds the SMS link is unauthenticated by
    construction, so the token has to be the entire boundary.
    """
    if not settings.livekit_ready:
        raise LiveVideoUnavailable(
            "LiveKit is not configured. Set LIVEKIT_URL, LIVEKIT_API_KEY and "
            "LIVEKIT_API_SECRET."
        )

    from livekit.api import AccessToken, VideoGrants

    room = room_name(visit_id)
    ttl = settings.livekit_token_ttl_minutes

    grant = VideoGrants(
        room=room,
        room_join=True,
        can_publish=True,
        can_publish_data=True,
        # The broker sends; they have no reason to receive anyone else's tracks,
        # and a token that cannot subscribe cannot be used to watch a stranger's
        # verification.
        can_subscribe=False,
    )

    token = (
        AccessToken(settings.livekit_api_key, settings.livekit_api_secret)
        .with_identity(f"broker-{visit_id}")
        .with_name(display_name or "Broker")
        .with_grants(grant)
        .with_ttl(timedelta(minutes=ttl))
        .to_jwt()
    )

    return LiveSession(
        room=room, token=token, url=settings.livekit_url, expires_in_minutes=ttl
    )


async def start_recording(visit_id: str) -> str | None:
    """Record the room to the configured bucket. Returns an egress id.

    Returns None — rather than raising — when recording is switched off or has
    no bucket to write to. A session that streams live and is not recorded still
    proves the broker was there; it simply leaves nothing to review afterwards.
    Failing the whole verification over a missing bucket would trade the thing
    that works for the thing that does not.
    """
    if not settings.livekit_record:
        return None
    if not settings.livekit_recording_bucket:
        log.warning(
            "live video: recording is on but LIVEKIT_RECORDING_BUCKET is empty — "
            "streaming without an artefact"
        )
        return None

    from livekit import api

    client = api.LiveKitAPI(
        url=settings.livekit_url,
        api_key=settings.livekit_api_key,
        api_secret=settings.livekit_api_secret,
    )
    try:
        request = api.RoomCompositeEgressRequest(
            room_name=room_name(visit_id),
            layout="speaker",
            audio_only=False,
            file_outputs=[
                api.EncodedFileOutput(
                    file_type=api.EncodedFileType.MP4,
                    filepath=f"site-visits/{visit_id}.mp4",
                    gcp=api.GCPUpload(bucket=settings.livekit_recording_bucket),
                )
            ],
        )
        info = await client.egress.start_room_composite_egress(request)
        log.info("live video: recording %s as egress %s", visit_id, info.egress_id)
        return info.egress_id
    except Exception:  # noqa: BLE001 - a failed recording must not fail the visit
        log.exception("live video: could not start recording for %s", visit_id)
        return None
    finally:
        await client.aclose()


def verify_webhook(body: bytes, auth_header: str | None):  # type: ignore[no-untyped-def]
    """Parse a LiveKit webhook, rejecting anything not signed by LiveKit.

    The webhook is what moves a visit to "video received", so an unauthenticated
    endpoint here would let anyone mark any property verified by posting a JSON
    body. The signature is the only thing preventing that, and it is checked
    before the payload is looked at.
    """
    if not settings.livekit_ready:
        raise LiveVideoUnavailable("LiveKit is not configured.")
    if not auth_header:
        raise ValueError("unsigned webhook")

    from livekit.api import TokenVerifier, WebhookReceiver

    receiver = WebhookReceiver(
        TokenVerifier(settings.livekit_api_key, settings.livekit_api_secret)
    )
    return receiver.receive(body.decode("utf-8"), auth_header)
