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
import re
from functools import lru_cache
from pathlib import Path

import firebase_admin
from firebase_admin import credentials, storage

from app.config import settings

log = logging.getLogger(__name__)

#: Where a host mounts secret files. Render places each Secret File both under
#: /etc/secrets and in the service's root directory, which is the working
#: directory the app runs in.
SECRET_DIRS: tuple[Path, ...] = (Path("/etc/secrets"), Path.cwd())


def credentials_path() -> Path | None:
    """The service-account file to use, or ``None`` when there is none.

    ``FIREBASE_CREDENTIALS_FILE`` is used as given when it names a real file.
    When it does not, the file is looked for by name wherever the host mounts
    secrets, and the setting's surrounding quotes and whitespace are ignored.

    That is not defensive padding. The live service had the value copied from a
    laptop's .env — ``"C:\\Users\\…\\khoj-cd80b-firebase-adminsdk-….json"``,
    quote marks included — while the same file was mounted as a Secret File.
    Every sign-in failed on the missing path, and every signed-in customer was
    silently saved as anonymous, which emptied their history.
    """
    raw = (settings.firebase_credentials_file or "").strip().strip("\"'").strip()
    if not raw:
        return None

    given = Path(raw)
    if given.is_file():
        return given

    # A Windows path does not split on backslashes under Linux, so the file
    # name is taken by hand rather than with Path(raw).name.
    name = re.split(r"[\\/]", raw)[-1]
    for folder in SECRET_DIRS:
        for candidate in (folder / name, folder / "serviceAccountKey.json"):
            if candidate.is_file():
                return candidate
    return None


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
    # Bounded. The SDK waits up to two minutes by default, and its calls are
    # synchronous — a slow Google endpoint must cost a request, not the worker.
    options["httpTimeout"] = settings.firebase_http_timeout_s

    configured = settings.firebase_credentials_file
    path = credentials_path()
    if path:
        if str(path) != (configured or "").strip():
            log.warning(
                "firebase: FIREBASE_CREDENTIALS_FILE is %r; using %s, which exists. "
                "Set it to that path to silence this.",
                configured,
                path,
            )
        log.info("firebase: using service account %s", path.name)
        return firebase_admin.initialize_app(credentials.Certificate(str(path)), options)

    if configured:
        # This used to raise. Raising here did not stop anything bad: it made
        # every token verification fail, and optional sign-in turned each of
        # those into an anonymous request. Verifying a token needs only the
        # project id, so sign-in carries on without the file — minus the
        # revocation check, which is what the file is actually for.
        log.error(
            "firebase: FIREBASE_CREDENTIALS_FILE is %r, and no such file exists there "
            "or under %s. Sign-in does not need it (tokens are verified against "
            "Google's public keys and the project id); the revocation lookup and "
            "Storage do. Point it at the mounted file, e.g. /etc/secrets/<name>.",
            configured,
            ", ".join(str(d) for d in SECRET_DIRS),
        )

    log.info("firebase: using application default credentials")
    return firebase_admin.initialize_app(options=options)


def has_service_credential() -> bool:
    """Whether Firebase can make *authenticated* calls on our behalf.

    Verifying an ID token needs no credential: the signature is checked against
    Google's public certificates and the audience against the project id, both
    of which a project id alone satisfies. Anything that reads back from the
    Identity Toolkit API — looking a user up, checking whether a token has been
    revoked — does need one.

    Kept separate because conflating the two is expensive in exactly the wrong
    direction: it makes an optional freshness check into a hard prerequisite for
    signing in at all.
    """
    return credentials_path() is not None



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
