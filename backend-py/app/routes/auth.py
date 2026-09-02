"""Sign-in and subscription endpoints."""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, ConfigDict

from app.config import settings
from app.core.auth import CurrentUser, read_quota, set_tier
from app.core.plans import PLAN_LIMITS, Quota, Tier, plan_catalogue
from app.models import UserProfile

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["account"])


class TierChange(BaseModel):
    model_config = ConfigDict(extra="forbid")
    tier: Tier


@router.get("/auth/config")
async def auth_config() -> dict[str, object]:
    """What the frontend needs to render sign-in, and whether it can work.

    ``ready`` is false when no Firebase project is configured, so the UI can
    avoid rendering a sign-in button that could never succeed.
    """
    return {
        "provider": "firebase",
        "project_id": settings.firebase_project_id or None,
        "auth_required": settings.auth_required,
        "ready": bool(settings.firebase_project_id or settings.firebase_credentials_file),
    }


@router.get("/auth/me")
async def me(user: CurrentUser) -> dict[str, object]:
    """The signed-in user and what their plan has left.

    Quota is read fresh from Firestore rather than from the token, because a
    plan can change between sign-in and now.
    """
    tier, limit, used = await read_quota(user.uid)
    quota = Quota(tier=tier, limit=limit, used=used)
    return {
        "user": user.model_dump(mode="json"),
        "quota": {
            "tier": tier.value,
            "limit": limit,
            "used": used,
            "remaining": quota.remaining,
            "exhausted": quota.exhausted,
            "message": quota.message(),
        },
    }


@router.get("/subscription")
async def subscription(user: CurrentUser) -> dict[str, object]:
    """The current plan alongside every plan, for an upgrade screen."""
    tier, limit, used = await read_quota(user.uid)
    quota = Quota(tier=tier, limit=limit, used=used)
    return {
        "current": {
            "tier": tier.value,
            "listings_limit": limit,
            "listings_used": used,
            "remaining": quota.remaining,
        },
        "plans": plan_catalogue(),
        "message": quota.message(),
    }


@router.post("/subscription/mock-upgrade")
async def mock_upgrade(body: TierChange, user: CurrentUser) -> dict[str, object]:
    """Move a user between tiers without taking payment.

    There is no payment provider wired up anywhere in this codebase. This exists
    so a plan can be changed during a demo, and it is named to make that
    obvious rather than looking like a billing endpoint someone might trust.
    """
    if settings.env == "prod":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Plan changes are not available here.",
        )

    profile: UserProfile = await set_tier(user.uid, body.tier)
    log.info("subscription: %s moved to %s (mock)", user.uid, body.tier.value)
    return {
        "ok": True,
        "tier": profile.tier,
        "listings_limit": PLAN_LIMITS[body.tier],
        "note": "Mock upgrade — no payment was taken.",
    }
