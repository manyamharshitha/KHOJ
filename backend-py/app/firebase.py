"""Firebase Admin initialisation: Firestore for documents, Storage for audio.

Built lazily and exactly once. ``initialize_app`` raises on a second call, and a
watch-mode dev server re-imports modules freely, so the guard is load-bearing
rather than defensive padding.
"""

from __future__ import annotations

import datetime as dt
import logging
import os
from functools import lru_cache
from pathlib import Path

import firebase_admin
from firebase_admin import credentials, firestore_async, storage
from google.cloud.firestore_v1.async_client import AsyncClient

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


def emulator_host() -> str | None:
    """The local Firestore emulator, if one is configured."""
    return os.environ.get("FIRESTORE_EMULATOR_HOST") or None


@lru_cache(maxsize=1)
def get_db() -> AsyncClient:
    """Async Firestore client.

    Async matters here: this backend holds many calls open at once, and a
    blocking driver would stall the event loop those calls are running on.

    Against the emulator the client is built directly with anonymous
    credentials. ``initialize_app()`` with no credential still resolves
    Application Default Credentials — so on a laptop with no gcloud login it
    spends thirty seconds probing an unreachable metadata server and then fails,
    even though the emulator needs no authentication at all.
    """
    host = emulator_host()
    if host:
        from google.auth.credentials import AnonymousCredentials
        from google.cloud.firestore import AsyncClient as FirestoreAsyncClient

        project = settings.firebase_project_id or os.environ.get(
            "GOOGLE_CLOUD_PROJECT", "khoj-local"
        )
        log.info("firebase: using Firestore emulator at %s (project %s)", host, project)
        return FirestoreAsyncClient(project=project, credentials=AnonymousCredentials())

    # ``firestore_async.client``, not ``firestore.async_client`` — the latter
    # does not exist and fails only at the first database call, a long way from
    # where the mistake was made.
    return firestore_async.client(app=_app())


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
