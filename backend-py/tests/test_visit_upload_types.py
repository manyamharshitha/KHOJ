"""A recording made in Chrome is accepted.

Seen in a demo recording: the broker filmed on the verify page and was told
"Only a video recording can be uploaded." Chrome's MediaRecorder labels its file
"video/webm;codecs=vp8,opus", and the check compared that exactly against
"video/webm".
"""

from __future__ import annotations

import io

import pytest
from fastapi import HTTPException, UploadFile
from starlette.datastructures import Headers

from app import repositories as repo
from app.config import settings
from app.models import SiteVisit, SiteVisitStatus, utcnow
from app.routes.visits import upload

pytestmark = pytest.mark.usefixtures("mongo_db")

#: The start of a real WebM/Matroska file: the EBML header, then padding.
WEBM_BYTES = b"\x1a\x45\xdf\xa3" + b"\x00" * 2048


async def a_visit_token(visit_id: str) -> str:
    await repo.save_site_visit(
        SiteVisit(
            id=visit_id,
            listing_id="lst_upload",
            requested_by="usr_upload",
            broker_phone="+919000000088",
            scheduled_for=utcnow(),
        )
    )
    return await repo.issue_visit_token(visit_id)


def a_file(content_type: str, data: bytes = WEBM_BYTES) -> UploadFile:
    return UploadFile(
        file=io.BytesIO(data),
        filename="visit.webm",
        headers=Headers({"content-type": content_type}),
    )


@pytest.mark.parametrize(
    "content_type",
    [
        "video/webm;codecs=vp8,opus",  # Chrome
        "video/webm; codecs=vp9",
        "video/x-matroska;codecs=avc1,opus",  # Chrome recording H.264
        "video/webm",
    ],
)
async def test_chrome_recordings_are_accepted(
    content_type: str, tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "site_visit_dir", str(tmp_path))
    visit_id = f"vis_{abs(hash(content_type)) % 10_000}"
    token = await a_visit_token(visit_id)

    body = await upload(token, video=a_file(content_type), lat=None, lng=None, seconds=30.0)

    assert body["status"] == SiteVisitStatus.VIDEO_RECEIVED.value
    stored = await repo.get_site_visit(visit_id)
    assert stored.video_bytes == len(WEBM_BYTES)


async def test_something_that_is_not_a_video_is_still_refused(
    tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "site_visit_dir", str(tmp_path))
    token = await a_visit_token("vis_png")

    with pytest.raises(HTTPException) as caught:
        await upload(token, video=a_file("image/png", b"\x89PNG" + b"\x00" * 100), lat=None, lng=None, seconds=1.0)

    assert caught.value.status_code == 415


async def test_a_video_label_on_bytes_that_are_not_video_is_refused(
    tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Dropping the codec parameters must not loosen the check on the file itself."""
    monkeypatch.setattr(settings, "site_visit_dir", str(tmp_path))
    token = await a_visit_token("vis_fake")

    with pytest.raises(HTTPException) as caught:
        await upload(token, video=a_file("video/webm;codecs=vp8", b"not a video at all" * 10), lat=None, lng=None, seconds=1.0)

    assert caught.value.status_code == 415
