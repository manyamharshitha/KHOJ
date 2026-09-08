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

from fastapi import APIRouter, File, Form, HTTPException, UploadFile, status
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

    distance: float | None = None
    if captured and visit.expected_point:
        distance = haversine_m(
            visit.expected_point.lat, visit.expected_point.lng, captured.lat, captured.lng
        )

    late = now > visit.scheduled_for + timedelta(minutes=settings.site_visit_grace_minutes)

    # Order matters. Lateness is a fact about this upload; a GPS mismatch is a
    # judgement about a noisy sensor. Report the certain one first.
    if late:
        outcome = SiteVisitStatus.LATE_SUBMISSION
    elif distance is None:
        # Nothing to compare against - no phone GPS, or an address that could not
        # be geocoded. Received, not verified.
        outcome = SiteVisitStatus.VIDEO_RECEIVED
    elif distance > settings.site_visit_radius_m:
        outcome = SiteVisitStatus.GPS_MISMATCH
    else:
        outcome = SiteVisitStatus.VERIFIED

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
