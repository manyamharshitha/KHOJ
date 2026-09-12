"""Khoj Verified: live video proof that someone stood at the property.

The claim this makes is narrow and worth stating exactly, because it is the only
thing the badge means: *a video was recorded from a device whose GPS was within
a set radius of the address, within a set window of the agreed time.* It does not
prove the flat in the video is the flat in the advert, that the person holding
the phone is the broker, or that the video is not a replay of an earlier one.

Three deliberate choices follow from that:

* **The upload link is a bearer token.** Whoever holds it can upload. It goes out
  by SMS to one number, is long and random, is stored separately from the
  document id, and is never returned by any read. The visit id is not the token,
  because ids leak into logs and URLs.
* **A GPS mismatch is not a failure.** GPS indoors is routinely tens of metres
  out. A mismatch is recorded with the measured distance and flagged for a
  person; nothing here auto-fails a broker on a satellite fix.
* **No point, no verdict.** If the address could not be geocoded there is
  nothing to compare against, and the visit says so instead of passing.
"""

from __future__ import annotations

import logging
from datetime import timedelta
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile, status
from pydantic import Field

from app.config import settings
from app.core.auth import OptionalUser, require_user
from app.core.geo import geocode, geocoding_available, haversine_m
from app.core.sms import send_sms, sms_available
from app.llm.extractor import to_e164
from app.models import (
    Base,
    GeoPoint,
    NotificationType,
    SiteVisit,
    SiteVisitStatus,
    utcnow,
)
from app.repositories import (
    get_listing,
    get_site_visit,
    issue_visit_token,
    new_id,
    save_site_visit,
    site_visits_for_listing,
    site_visits_for_user,
    token_for_visit,
    update_site_visit,
    visit_for_token,
)
from app.routes.notifications import notify
from app.services.live_video import (
    LiveVideoUnavailable,
    broker_token,
    start_recording,
    verify_webhook,
    visit_id_from_room,
)

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/visits", tags=["visits"])

#: What a browser is allowed to upload. MediaRecorder emits webm on Chrome and
#: mp4 on Safari; anything else is not a phone recording a video.
_ALLOWED_TYPES = {"video/webm", "video/mp4", "video/quicktime"}

#: Magic bytes, checked because Content-Type is whatever the client claims.
#: WebM is EBML (1A 45 DF A3); MP4/QuickTime carry 'ftyp' at offset 4.
_WEBM_MAGIC = b"\x1a\x45\xdf\xa3"


class ScheduleRequest(Base):
    listing_id: str
    #: When the broker has agreed to be at the property.
    scheduled_for: str = Field(description="ISO-8601 datetime")
    broker_phone: str | None = None


def _store_dir() -> Path:
    path = Path(settings.site_visit_dir)
    path.mkdir(parents=True, exist_ok=True)
    return path


def _looks_like_video(head: bytes) -> bool:
    return head.startswith(_WEBM_MAGIC) or head[4:8] == b"ftyp"


@router.post("/schedule")
async def schedule(body: ScheduleRequest, user: OptionalUser) -> dict[str, object]:
    """Book a time and prepare the request. Sends nothing yet."""
    from datetime import datetime

    account = await require_user(user)

    listing = await get_listing(body.listing_id)
    if listing is None:
        raise HTTPException(status_code=404, detail="No such listing.")

    try:
        when = datetime.fromisoformat(body.scheduled_for.replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="scheduled_for must be an ISO-8601 datetime.",
        ) from None
    if when.tzinfo is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="scheduled_for must carry a timezone offset.",
        )

    phone = to_e164(body.broker_phone) if body.broker_phone else listing.contact_number
    if not phone:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="No number to send the request to. Add the broker's number first.",
        )

    address = listing.title or listing.locality or ""
    point = await geocode(address) if address else None

    visit = SiteVisit(
        id=new_id("svt"),
        listing_id=body.listing_id,
        requested_by=account.uid,
        broker_phone=phone,
        scheduled_for=when,
        property_address=address or None,
        expected_point=GeoPoint(lat=point[0], lng=point[1]) if point else None,
    )
    await save_site_visit(visit)
    # The token is not the id. An id reaches logs, URLs and error reports; this
    # is an upload credential and only ever travels in one SMS.
    token = await issue_visit_token(visit.id)

    await notify(
        account.uid,
        NotificationType.VISIT_SCHEDULED,
        f"Video verification booked for {when:%d %b, %H:%M}.",
        visit.id,
    )

    return {
        "visit": visit.model_dump(mode="json"),
        "upload_url": f"{settings.public_base_url.rstrip('/')}/verify/{token}",
        "sms_configured": sms_available(),
        "geocoded": point is not None,
        "note": None
        if point
        else (
            "The property address could not be placed on a map, so the location "
            "check cannot run. The video will still be recorded and timed."
            if geocoding_available()
            else "Geocoding is not configured, so the location check cannot run."
        ),
    }


@router.post("/{visit_id}/send")
async def send_request(visit_id: str, user: OptionalUser) -> dict[str, object]:
    """Text the broker the upload link.

    Separate from scheduling so the message goes out at the agreed time rather
    than hours early. Status only moves to SMS_SENT when the message actually
    left — a visit that later expires must not blame a broker who was never
    contacted.
    """
    account = await require_user(user)
    visit = await get_site_visit(visit_id)
    if visit is None or visit.requested_by != account.uid:
        raise HTTPException(status_code=404, detail="No such verification.")

    token = await token_for_visit(visit_id) or await issue_visit_token(visit_id)
    link = f"{settings.public_base_url.rstrip('/')}/verify/{token}"
    address = visit.property_address or "the property"
    result = await send_sms(
        visit.broker_phone,
        f"Khoj: a prospective tenant has asked for a short live video from {address}. "
        f"Please open this link and record 2 minutes now: {link}",
    )

    if result.sent:
        await update_site_visit(
            visit_id, status=SiteVisitStatus.SMS_SENT.value, sms_sent_at=utcnow()
        )
    return {"sent": result.sent, "reason": result.reason, "link": link}


def decide_outcome(
    visit: SiteVisit, captured: GeoPoint | None, now: datetime
) -> tuple[SiteVisitStatus, float | None]:
    """What the evidence proves, and how far off the location was.

    Shared by the upload and the live paths on purpose. Two copies of this would
    drift, and the drift would be silent: a property could come out verified
    over one route and flagged over the other from identical evidence, which is
    the kind of inconsistency nobody notices until a renter is standing outside
    the wrong building.

    Order matters. Lateness is a fact about when this arrived; a GPS mismatch is
    a judgement about a noisy sensor. The certain one is reported first.
    """
    distance: float | None = None
    if captured and visit.expected_point:
        distance = haversine_m(
            visit.expected_point.lat, visit.expected_point.lng, captured.lat, captured.lng
        )

    if now > visit.scheduled_for + timedelta(minutes=settings.site_visit_grace_minutes):
        return SiteVisitStatus.LATE_SUBMISSION, distance
    if distance is None:
        # No phone GPS, or an address that could not be geocoded. Received, not
        # verified — the difference is the whole product.
        return SiteVisitStatus.VIDEO_RECEIVED, distance
    if distance > settings.site_visit_radius_m:
        return SiteVisitStatus.GPS_MISMATCH, distance
    return SiteVisitStatus.VERIFIED, distance


@router.get("/token/{token}")
async def capture_page_context(token: str) -> dict[str, object]:
    """What the broker's phone needs to render the capture page.

    Returns the address and the deadline and nothing else — not the renter, not
    the listing, not the other verifications on it. Whoever holds this link is
    unauthenticated by construction.
    """
    visit = await visit_for_token(token)
    if visit is None:
        raise HTTPException(status_code=404, detail="That link is not valid.")

    if visit.status in (SiteVisitStatus.VERIFIED, SiteVisitStatus.VIDEO_RECEIVED):
        raise HTTPException(status_code=409, detail="A video has already been received.")

    return {
        "address": visit.property_address,
        "scheduled_for": visit.scheduled_for.isoformat(),
        "seconds": 120,
        "expires_in_minutes": settings.site_visit_grace_minutes,
    }


@router.post("/token/{token}/upload")
async def upload(
    token: str,
    video: UploadFile = File(...),
    lat: float | None = Form(default=None),
    lng: float | None = Form(default=None),
    seconds: float | None = Form(default=None),
) -> dict[str, object]:
    """Receive the video and decide what it proves.

    Unauthenticated on purpose: the broker has no Khoj account. The token is the
    credential, and it is single-use — a second upload is refused rather than
    quietly replacing the first.
    """
    visit = await visit_for_token(token)
    if visit is None:
        raise HTTPException(status_code=404, detail="That link is not valid.")
    if visit.status in (SiteVisitStatus.VERIFIED, SiteVisitStatus.VIDEO_RECEIVED):
        raise HTTPException(status_code=409, detail="A video has already been received.")

    if video.content_type not in _ALLOWED_TYPES:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Only a video recording can be uploaded.",
        )

    # Read with a ceiling rather than trusting Content-Length, which the client
    # also controls. One byte over the limit is enough to reject.
    body = await video.read(settings.site_visit_max_bytes + 1)
    if len(body) > settings.site_visit_max_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"That video is larger than {settings.site_visit_max_bytes // (1024 * 1024)} MB.",
        )
    if not _looks_like_video(body[:16]):
        # Content-Type is whatever the client claims; the bytes are not.
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="That file is not a video.",
        )

    suffix = ".mp4" if body[4:8] == b"ftyp" else ".webm"
    path = _store_dir() / f"{visit.id}{suffix}"
    path.write_bytes(body)

    now = utcnow()
    captured = GeoPoint(lat=lat, lng=lng) if lat is not None and lng is not None else None
    outcome, distance = decide_outcome(visit, captured, now)
    late = outcome is SiteVisitStatus.LATE_SUBMISSION

    updated = await update_site_visit(
        visit.id,
        status=outcome.value,
        video_url=str(path),
        video_bytes=len(body),
        video_seconds=seconds,
        captured_point=captured.to_document() if captured else None,
        captured_at=now,
        distance_m=distance,
    )

    await notify(
        visit.requested_by,
        NotificationType.VISIT_COMPLETE,
        {
            SiteVisitStatus.VERIFIED: "Video verified - the location matched.",
            SiteVisitStatus.GPS_MISMATCH: "Video received, but the location did not match.",
            SiteVisitStatus.LATE_SUBMISSION: "Video arrived after the agreed window.",
            SiteVisitStatus.VIDEO_RECEIVED: "Video received. The location could not be checked.",
        }[outcome],
        visit.id,
    )

    log.info(
        "visit %s: %s (distance=%s, late=%s, %d bytes)",
        visit.id,
        outcome.value,
        f"{distance:.0f}m" if distance is not None else "unknown",
        late,
        len(body),
    )
    return {
        "status": outcome.value,
        "distance_m": round(distance) if distance is not None else None,
        "verified": outcome is SiteVisitStatus.VERIFIED,
    }


# --------------------------------------------------------------------------
# live video
# --------------------------------------------------------------------------


@router.post("/token/{token}/live")
async def start_live(token: str) -> dict[str, object]:
    """Mint a join token so the broker can stream, and start recording.

    Unauthenticated, like the upload beside it: the broker has no Khoj account
    and the link is the credential. The LiveKit token minted here is narrower
    still — one room, publish only, and it expires in minutes.
    """
    visit = await visit_for_token(token)
    if visit is None:
        raise HTTPException(status_code=404, detail="That link is not valid.")
    if visit.status in (SiteVisitStatus.VERIFIED, SiteVisitStatus.VIDEO_RECEIVED):
        raise HTTPException(status_code=409, detail="This property has already been verified.")

    try:
        session = broker_token(visit.id)
    except LiveVideoUnavailable as exc:
        # 503 rather than 500: nothing is broken, the server simply has no live
        # video configured, and the page can offer the upload instead.
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    await start_recording(visit.id)
    await update_site_visit(visit.id, status=SiteVisitStatus.STREAMING.value)

    log.info("visit %s: live session opened in room %s", visit.id, session.room)
    return {
        "url": session.url,
        "token": session.token,
        "room": session.room,
        "expires_in_minutes": session.expires_in_minutes,
        "address": visit.property_address,
    }


@router.post("/token/{token}/location")
async def report_location(token: str, lat: float, lng: float) -> dict[str, object]:
    """Record where the phone says it is, while the stream is running.

    Posted during the session rather than after it, because that is the claim
    being made: the device was at these coordinates *at the moment it was
    streaming*. A fix sent afterwards proves only where somebody stood later.
    """
    visit = await visit_for_token(token)
    if visit is None:
        raise HTTPException(status_code=404, detail="That link is not valid.")

    captured = GeoPoint(lat=lat, lng=lng)
    distance: float | None = None
    if visit.expected_point:
        distance = haversine_m(
            visit.expected_point.lat, visit.expected_point.lng, captured.lat, captured.lng
        )

    await update_site_visit(
        visit.id,
        captured_point=captured.to_document(),
        captured_at=utcnow(),
        distance_m=distance,
    )
    return {
        "distance_m": round(distance) if distance is not None else None,
        # Told to the broker so they can move outside if the fix is poor, rather
        # than finishing a stream that was never going to pass.
        "within_range": distance is not None and distance <= settings.site_visit_radius_m,
    }


@router.post("/webhook/livekit")
async def livekit_webhook(request: Request) -> dict[str, object]:
    """LiveKit tells us the room ended or the recording finished.

    Signature-checked before the body is read. This endpoint is what moves a
    visit to verified, so an unauthenticated version of it would let anyone mark
    any property verified by posting JSON.
    """
    body = await request.body()
    try:
        event = verify_webhook(body, request.headers.get("Authorization"))
    except LiveVideoUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001 - a bad signature is not our error
        log.warning("livekit webhook rejected: %s", exc)
        raise HTTPException(status_code=401, detail="Unsigned or invalid webhook.") from exc

    name = getattr(event, "event", "")
    room = getattr(getattr(event, "room", None), "name", "") or ""
    visit_id = visit_id_from_room(room)
    if not visit_id:
        # Some other room on the same LiveKit project. Not ours, not an error.
        return {"ignored": name}

    visit = await get_site_visit(visit_id)
    if visit is None:
        log.warning("livekit webhook for unknown visit %s", visit_id)
        return {"ignored": "unknown visit"}

    if name == "egress_ended":
        egress = getattr(event, "egress_info", None)
        files = list(getattr(egress, "file_results", None) or [])
        location = getattr(files[0], "location", None) if files else None
        duration_ns = getattr(files[0], "duration", 0) if files else 0

        outcome, distance = decide_outcome(visit, visit.captured_point, utcnow())
        await update_site_visit(
            visit.id,
            status=outcome.value,
            video_url=location,
            video_seconds=(duration_ns / 1_000_000_000) if duration_ns else None,
            distance_m=distance,
        )
        await notify(
            visit.requested_by,
            NotificationType.VISIT_COMPLETE,
            _OUTCOME_MESSAGE[outcome],
            visit.id,
        )
        log.info("visit %s: live recording finished — %s", visit.id, outcome.value)
        return {"visit": visit.id, "status": outcome.value}

    if name == "room_finished" and visit.status is SiteVisitStatus.STREAMING:
        # The stream ended and no recording is coming — either recording is off,
        # or egress failed. The session still happened, so it is judged on the
        # GPS fix taken while it was live rather than discarded.
        outcome, distance = decide_outcome(visit, visit.captured_point, utcnow())
        await update_site_visit(visit.id, status=outcome.value, distance_m=distance)
        await notify(
            visit.requested_by,
            NotificationType.VISIT_COMPLETE,
            _OUTCOME_MESSAGE[outcome],
            visit.id,
        )
        log.info("visit %s: live session ended — %s", visit.id, outcome.value)
        return {"visit": visit.id, "status": outcome.value}

    return {"ignored": name}


#: What the renter is told, per outcome. One phrasing, used by both paths.
_OUTCOME_MESSAGE = {
    SiteVisitStatus.VERIFIED: "Video verified - the location matched.",
    SiteVisitStatus.GPS_MISMATCH: "Video received, but the location did not match.",
    SiteVisitStatus.LATE_SUBMISSION: "Video arrived after the agreed window.",
    SiteVisitStatus.VIDEO_RECEIVED: "Video received. The location could not be checked.",
}


@router.post("/{visit_id}/override")
async def override(visit_id: str, reason: str, user: OptionalUser) -> dict[str, object]:
    """Accept a visit the distance check flagged.

    GPS indoors is bad enough that a mismatch is routinely wrong. The override
    is recorded with its reason rather than silently flipping the status, so the
    badge can say it was accepted by a person.
    """
    account = await require_user(user)
    visit = await get_site_visit(visit_id)
    if visit is None or visit.requested_by != account.uid:
        raise HTTPException(status_code=404, detail="No such verification.")
    if visit.status is not SiteVisitStatus.GPS_MISMATCH:
        raise HTTPException(status_code=409, detail="Only a location mismatch can be overridden.")

    updated = await update_site_visit(
        visit_id, status=SiteVisitStatus.VERIFIED.value, override_reason=reason[:400]
    )
    return {"visit": updated.model_dump(mode="json") if updated else None}


@router.get("/mine")
async def list_mine(user: OptionalUser) -> dict[str, object]:
    account = await require_user(user)
    visits = await site_visits_for_user(account.uid)
    return {"visits": [v.model_dump(mode="json") for v in visits]}


@router.get("/listing/{listing_id}")
async def list_for_listing(listing_id: str) -> dict[str, object]:
    visits = await site_visits_for_listing(listing_id)
    return {
        "visits": [v.model_dump(mode="json") for v in visits],
        "verified": any(v.is_verified for v in visits),
    }
