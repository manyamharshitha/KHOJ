"""Google Sign-In, verified through Firebase.

The browser completes Google sign-in and hands us a Firebase ID token. This
module verifies it with the Admin SDK and resolves it to a profile in the
``users`` collection.

No password ever reaches this server, so there is nothing here to leak and no
forgot-password flow to build — Firebase owns that. Every sign-in method a
Firebase project has enabled (Google, email/password, phone) arrives as the same
kind of token, so they are all one code path.
"""

from __future__ import annotations

import logging
from typing import Annotated, Any

from fastapi import Depends, Header, HTTPException, status
from firebase_admin import auth as fb_auth

from app.config import settings
from app.core.plans import DEFAULT_TIER, Tier, limit_for, normalise_tier
from app.firebase import get_db
from app.models import UserProfile, utcnow

log = logging.getLogger(__name__)

USERS = "users"


class AuthError(HTTPException):
    """401 with a message safe to show a user.

    The *reason* verification failed is never echoed. Telling an attacker which
    check they tripped is telling them how to pass it.
    """

    def __init__(self, detail: str = "Sign in to continue.") -> None:
        super().__init__(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=detail,
            headers={"WWW-Authenticate": "Bearer"},
        )


def _bearer(authorization: str | None) -> str | None:
    if not authorization:
        return None
    scheme, _, token = authorization.partition(" ")
    return token.strip() if scheme.lower() == "bearer" and token.strip() else None


def verify_google_token(id_token: str) -> dict[str, Any]:
    """Verify a Firebase ID token and return its claims.

    ``check_revoked=True`` costs an extra lookup and is worth it: without it a
    token stays valid for its full hour after the user signs out or an account is
    disabled.
    """
    try:
        return fb_auth.verify_id_token(id_token, check_revoked=True)
    except fb_auth.RevokedIdTokenError as exc:
        raise AuthError("That session has ended. Sign in again.") from exc
    except fb_auth.ExpiredIdTokenError as exc:
        raise AuthError("That session has expired. Sign in again.") from exc
    except fb_auth.UserDisabledError as exc:
        raise AuthError("That account has been disabled.") from exc
    except Exception as exc:  # noqa: BLE001 - many SDK error types, one answer
        log.warning("auth: token rejected (%s)", type(exc).__name__)
        raise AuthError("That sign-in could not be verified.") from exc


async def get_or_create_user(
    uid: str, email: str | None, name: str | None = None, picture: str | None = None
) -> UserProfile:
    """Fetch the user's profile, creating it on first sign-in.

    A new account starts on the free tier with two verifications. The tier is
    read from Firestore rather than the token, because a plan is something this
    system grants — an ID token claim would be attacker-influenced.
    """
    doc = get_db().collection(USERS).document(uid)
    snap = await doc.get()

    if snap.exists:
        data = snap.to_dict() or {}
        tier = normalise_tier(data.get("tier"))
        profile = UserProfile(
            uid=uid,
            email=data.get("email") or email or "",
            name=data.get("name") or name,
            picture=data.get("picture") or picture,
            tier=tier,
            listings_limit=limit_for(tier),
            listings_used=int(data.get("listings_used") or 0),
            created_at=data.get("created_at") or utcnow(),
        )
        # Google's display name and avatar change; the tier and usage do not get
        # touched here.
        await doc.update({"last_seen_at": utcnow(), "email": profile.email, "name": profile.name})
        return profile

    profile = UserProfile(
        uid=uid,
        email=email or "",
        name=name,
        picture=picture,
        tier=DEFAULT_TIER,
        listings_limit=limit_for(DEFAULT_TIER),
        listings_used=0,
    )
    await doc.set(
        {
            **profile.model_dump(mode="python", exclude={"uid"}),
            "last_seen_at": utcnow(),
        }
    )
    log.info("auth: created profile for %s (%s)", uid, profile.email)
    return profile


async def current_user(
    authorization: Annotated[str | None, Header()] = None,
) -> UserProfile:
    """FastAPI dependency: the signed-in user, or 401.

    ``DEV_AUTH_TOKEN`` short-circuits this for automated tests. It is refused
    unless explicitly configured, so it cannot be left on by accident in a
    deployment that never sets it.
    """
    token = _bearer(authorization)
    if not token:
        raise AuthError()

    if settings.dev_auth_token and token == settings.dev_auth_token:
        return UserProfile(
            uid="usr_dev",
            email="dev@localhost",
            name="Dev",
            tier=Tier.PREMIUM,
            listings_limit=limit_for(Tier.PREMIUM),
            listings_used=0,
        )

    claims = verify_google_token(token)
    return await get_or_create_user(
        uid=claims["uid"],
        email=claims.get("email"),
        name=claims.get("name"),
        picture=claims.get("picture"),
    )


async def optional_user(
    authorization: Annotated[str | None, Header()] = None,
) -> UserProfile | None:
    """The user if signed in, otherwise ``None``.

    Used where ``AUTH_REQUIRED`` is off so the demo and the tests keep working
    without a Firebase project.
    """
    if not _bearer(authorization):
        return None
    try:
        return await current_user(authorization)
    except HTTPException:
        return None


CurrentUser = Annotated[UserProfile, Depends(current_user)]
OptionalUser = Annotated["UserProfile | None", Depends(optional_user)]


async def require_user(user: UserProfile | None) -> UserProfile:
    """Turn an optional user into a required one, honouring ``AUTH_REQUIRED``."""
    if user is not None:
        return user
    if settings.auth_required:
        raise AuthError()
    return UserProfile(
        uid="anonymous",
        email="",
        tier=DEFAULT_TIER,
        listings_limit=limit_for(DEFAULT_TIER),
        listings_used=0,
    )


# --------------------------------------------------------------------------
# subscription
# --------------------------------------------------------------------------


async def set_tier(uid: str, tier: Tier) -> UserProfile:
    """Change a user's plan.

    No payment provider is wired up. This exists so a tier can be moved during a
    demo, and the endpoint that calls it says as much.
    """
    doc = get_db().collection(USERS).document(uid)
    await doc.update({"tier": tier.value, "listings_limit": limit_for(tier), "updated_at": utcnow()})
    snap = await doc.get()
    data = snap.to_dict() or {}
    return UserProfile(
        uid=uid,
        email=data.get("email", ""),
        name=data.get("name"),
        picture=data.get("picture"),
        tier=tier,
        listings_limit=limit_for(tier),
        listings_used=int(data.get("listings_used") or 0),
        created_at=data.get("created_at") or utcnow(),
    )


async def consume_quota(uid: str, count: int = 1) -> None:
    """Record verifications spent.

    Uses an atomic increment rather than read-modify-write: two searches running
    at once would otherwise both read the old value and one increment would
    vanish, handing out free verifications.
    """
    if uid in ("anonymous", "usr_dev") or count <= 0:
        return
    from google.cloud.firestore_v1 import Increment

    await get_db().collection(USERS).document(uid).update(
        {"listings_used": Increment(count), "updated_at": utcnow()}
    )


async def read_quota(uid: str) -> tuple[Tier, int, int]:
    """``(tier, limit, used)`` straight from Firestore.

    Read fresh at the moment of dialling rather than trusted from the session,
    because a plan can change while a long search is running.
    """
    if uid in ("anonymous", "usr_dev"):
        tier = Tier.PREMIUM if uid == "usr_dev" else DEFAULT_TIER
        return tier, limit_for(tier), 0

    snap = await get_db().collection(USERS).document(uid).get()
    data = snap.to_dict() or {}
    tier = normalise_tier(data.get("tier"))
    return tier, limit_for(tier), int(data.get("listings_used") or 0)
