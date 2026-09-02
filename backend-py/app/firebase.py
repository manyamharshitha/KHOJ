"""Firebase Admin initialisation: ID-token verification and Storage.

    Documents no longer live here. Firestore Enterprise edition speaks the
    MongoDB wire protocol, so persistence moved to ``app.core.db`` and
    ``app.repositories``; this module keeps only the two things the Admin SDK is
    still the right tool for — verifying Google ID tokens and signing URLs for
    call recordings.

Built lazily and exactly once. ``initialize_app`` raises on a second call, and a
watch-mode dev server re-imports modules freely, so the guard is load-bearing
rather than defensive padding.
"""

from __future__ import annotations

import datetime as dt
import logging
from functools import lru_cache
from pathlib import Path

import firebase_admin
from firebase_admin import credentials, storage

from app.config import settings

log = logging.getLogger(__name__)


@lru_cache(maxsize=1)
def _app() -> firebase_admin.App:
    """The single Firebase app.

    Two credential paths so the same code runs on a laptop with a downloaded
    service-account key and on Cloud Run, where the credential is ambient and
    no file exists.
    """
    if firebase_admin._apps:  # noqa: SLF001 - the SDK exposes no public accessor
        return firebase_admin.get_app()

    options = {}
    if settings.firebase_storage_bucket:
        options["storageBucket"] = settings.firebase_storage_bucket
    if settings.firebase_project_id:
        options["projectId"] = settings.firebase_project_id

    cred_path = settings.firebase_credentials_file
    if cred_path:
        path = Path(cred_path)
        if not path.is_file():
            raise RuntimeError(
                f"FIREBASE_CREDENTIALS_FILE points at {cred_path!r}, which does not exist."
            )
        log.info("firebase: using service account %s", path.name)
        return firebase_admin.initialize_app(credentials.Certificate(str(path)), options)

    log.info("firebase: using application default credentials")
    return firebase_admin.initialize_app(options=options)



@lru_cache(maxsize=1)
def get_bucket():  # type: ignore[no-untyped-def]  # SDK returns an untyped Bucket
    """Storage bucket for call recordings."""
    if not settings.firebase_storage_bucket:
        raise RuntimeError(
            "FIREBASE_STORAGE_BUCKET is not set — call recordings have nowhere to go."
        )
    return storage.bucket(app=_app())


async def upload_recording(
    *, data: bytes, path: str, content_type: str = "audio/mpeg", ttl_days: int = 7
) -> tuple[str, str]:
    """Store a call recording and return ``(object_path, signed_url)``.

    The URL is signed and time-limited rather than public. A recording contains
    a stranger's voice and phone number; it should not sit on a guessable public
    URL forever.

    Runs the blocking GCS calls in a worker thread so the event loop keeps
    serving other calls.
    """
    import anyio

    bucket = get_bucket()
    blob = bucket.blob(path)

    def _put() -> str:
        blob.upload_from_string(data, content_type=content_type)
        return blob.generate_signed_url(
            version="v4", expiration=dt.timedelta(days=ttl_days), method="GET"
        )

    url = await anyio.to_thread.run_sync(_put)
    log.info("firebase: stored recording %s (%d bytes)", path, len(data))
    return path, url


async def refresh_signed_url(path: str, ttl_days: int = 7) -> str:
    """Mint a fresh signed URL for an already-stored recording."""
    import anyio

    blob = get_bucket().blob(path)
    return await anyio.to_thread.run_sync(
        lambda: blob.generate_signed_url(
            version="v4", expiration=dt.timedelta(days=ttl_days), method="GET"
        )
    )
