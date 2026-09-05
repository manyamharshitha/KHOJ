"""Add a listing by hand.

The third ingestion path, beside crawling a portal and pasting a page. It exists
because the other two can both fail for reasons the customer cannot fix: a
portal keeps its phone numbers behind a login, or the page reader cannot start
on a small server. Somebody holding a number from a WhatsApp forward or a
notice board still has everything a verification call needs.

Nothing is scraped and nothing is extracted here — the fields arrive already
structured, so this skips straight to a ranked, dialable listing. Everything
downstream is unchanged: the same call-all endpoint, the same dialer, the same
honesty evaluation.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, status
from pydantic import Field, field_validator

from app.core.auth import OptionalUser, require_user
from app.models import (
    Base,
    Listing,
    Rupees,
    SearchCriteria,
    SearchSession,
    SessionStatus,
    TargetSite,
)
from app.repositories import (
    create_session,
    get_session,
    new_id,
    save_listings,
    update_session,
)

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/listings", tags=["listings"])

MANUAL_SOURCE = "Added by hand"
MANUAL_PLACEHOLDER_URL = "https://manual.local/"


class ManualListingRequest(Base):
    """``POST /api/listings/manual`` body.

    Only the phone number is required. Every other field is what the advert
    claimed, and an advert that omits the maintenance charge is exactly the case
    this product exists to catch — so a listing with nothing but a number is
    still worth calling.
    """

    contact_number: str = Field(min_length=8, max_length=20)

    title: str | None = Field(default=None, max_length=300)
    locality: str | None = Field(default=None, max_length=200)
    city: str | None = Field(default=None, max_length=120)
    bedrooms: int | None = Field(default=None, ge=0, le=20)
    property_type: str | None = Field(default=None, max_length=80)
    furnishing: str | None = Field(default=None, max_length=80)

    rent: Rupees | None = None
    maintenance: Rupees | None = None
    deposit: Rupees | None = None
    age_years: float | None = Field(default=None, ge=0, le=200)

    #: Free text the customer wants asked about on the call.
    notes: str | None = Field(default=None, max_length=2000)
    #: Added to the standard question set for this one call.
    custom_questions: list[str] = Field(default_factory=list, max_length=8)

    #: Attach to an existing search instead of starting one, so several
    #: hand-added listings can be called together under one quota check.
    session_id: str | None = None

    @field_validator("contact_number")
    @classmethod
    def _e164(cls, v: str) -> str:
        """Normalise to E.164, assuming India when no country code is given.

        A number typed as "98765 43210" is what a person actually has; the
        dialer needs "+919876543210". Rejecting the human form and making them
        reformat it is a worse product, so it is fixed here instead.
        """
        digits = "".join(ch for ch in v if ch.isdigit())
        if v.strip().startswith("+"):
            if len(digits) < 8:
                raise ValueError("that phone number is too short")
            return f"+{digits}"
        if len(digits) == 10:
            return f"+91{digits}"
        if len(digits) == 12 and digits.startswith("91"):
            return f"+{digits}"
        if len(digits) == 11 and digits.startswith("0"):
            return f"+91{digits[1:]}"
        raise ValueError(
            "Enter a 10-digit Indian mobile, or a full number starting with +"
        )


class ManualListingResponse(Base):
    session_id: str
    listing_id: str
    contact_number: str
    #: Always true here — a manual listing has a number by definition, which is
    #: the whole reason this path exists.
    is_callable: bool = True
    call_all_url: str


@router.post(
    "/manual", response_model=ManualListingResponse, status_code=status.HTTP_201_CREATED
)
async def add_manual_listing(
    body: ManualListingRequest, user: OptionalUser = None
) -> ManualListingResponse:
    """Create one listing from typed details and make it callable.

    The session is created already ``RANKED``: there is nothing to crawl, rank
    or extract, and leaving it ``QUEUED`` would strand it waiting for a pipeline
    that is never going to run.
    """
    account = await require_user(user)

    if body.session_id:
        session = await get_session(body.session_id)
        if session is None:
            raise HTTPException(status_code=404, detail="No such search.")
        session_id = session.id
    else:
        criteria = SearchCriteria(
            city=body.city,
            localities=[body.locality] if body.locality else [],
            bedrooms=body.bedrooms,
            furnishing=body.furnishing,
            custom_questions=body.custom_questions,
        )
        session = SearchSession(
            id=new_id("ses"),
            customer_id=account.uid if account.uid != "anonymous" else None,
            prompt=body.notes or f"Listing added by hand: {body.title or body.contact_number}",
            criteria=criteria,
            # Required by the schema and never fetched. It exists so the
            # provenance shown next to the result is honest about where the
            # listing came from.
            target_sites=[
                TargetSite(
                    name=MANUAL_SOURCE, url=MANUAL_PLACEHOLDER_URL, contact_gated=False
                )
            ],
            status=SessionStatus.RANKED,
        )
        await create_session(session)
        session_id = session.id

    listing = Listing(
        id=new_id("lst"),
        session_id=session_id,
        source_site=MANUAL_SOURCE,
        title=body.title,
        locality=body.locality,
        bedrooms=body.bedrooms,
        property_type=body.property_type,
        furnishing=body.furnishing,
        rent=body.rent,
        maintenance=body.maintenance,
        deposit=body.deposit,
        age_years=body.age_years,
        contact_number=body.contact_number,
        ai_match_reason="Added by hand, so nothing was matched against a search.",
    )
    await save_listings([listing])

    # Keep the session counters honest — the dashboard reads these.
    await update_session(
        session_id,
        status=SessionStatus.RANKED.value,
        listings_found=(session.listings_found or 0) + 1,
        listings_matched=(session.listings_matched or 0) + 1,
    )

    log.info("listings: manual entry %s on session %s", listing.id, session_id)

    return ManualListingResponse(
        session_id=session_id,
        listing_id=listing.id,
        contact_number=body.contact_number,
        call_all_url=f"/api/session/{session_id}/call-all",
    )
