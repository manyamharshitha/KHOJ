"""Deposit negotiation: draft, send, and keep the whole thread.

The history is the product here. A deposit conversation happens over days across
SMS and phone calls, and what people actually lose is the record of what was
agreed — so every offer, from either side, is appended and never edited.

Drafting is separate from sending, and that separation is deliberate. The model
proposes; the customer picks, edits, and sends. Nothing here dispatches a
message the customer has not seen.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, status
from pydantic import Field

from app.core.sms import send_sms, sms_available
from app.llm.negotiation import draft_offers, screen
from app.models import (
    Base,
    Negotiation,
    NegotiationOffer,
    NegotiationStatus,
    Notification,
    NotificationType,
    OfferParty,
    Rupees,
)
from app.repositories import (
    append_offer,
    create_notification,
    get_listing,
    get_negotiation,
    negotiations_for_listing,
    negotiations_for_user,
    new_id,
    save_negotiation,
)
from app.core.auth import OptionalUser, require_user

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/negotiations", tags=["negotiations"])


class StartRequest(Base):
    listing_id: str
    current_deposit: Rupees | None = None
    desired_deposit: Rupees | None = None
    reason: str = Field(default="", max_length=2000)


class SendRequest(Base):
    message: str = Field(min_length=1, max_length=1000)
    amount: Rupees | None = None
    ai_drafted: bool = False


class LogReplyRequest(Base):
    message: str = Field(min_length=1, max_length=2000)
    amount: Rupees | None = None


async def _owned(negotiation_id: str, uid: str) -> Negotiation:
    """Fetch a negotiation this account is actually part of."""
    negotiation = await get_negotiation(negotiation_id)
    if negotiation is None:
        raise HTTPException(status_code=404, detail="No such negotiation.")
    if uid not in (negotiation.renter_id, negotiation.broker_id):
        # 404 rather than 403: a negotiation you are not part of should not be
        # confirmed to exist.
        raise HTTPException(status_code=404, detail="No such negotiation.")
    return negotiation


@router.post("/start")
async def start(body: StartRequest, user: OptionalUser) -> dict[str, object]:
    account = await require_user(user)

    listing = await get_listing(body.listing_id)
    if listing is None:
        raise HTTPException(status_code=404, detail="No such listing.")

    # The advertised deposit unless the customer says otherwise: retyping a
    # number that is already on the listing is a chance to get it wrong.
    current = body.current_deposit if body.current_deposit is not None else listing.deposit

    negotiation = Negotiation(
        id=new_id("neg"),
        listing_id=body.listing_id,
        renter_id=account.uid,
        current_deposit=current,
        desired_deposit=body.desired_deposit,
        reason=body.reason,
    )
    await save_negotiation(negotiation)
    log.info("negotiation: %s opened on %s", negotiation.id, body.listing_id)
    return {"negotiation": negotiation.model_dump(mode="json")}


@router.post("/{negotiation_id}/drafts")
async def generate_drafts(negotiation_id: str, user: OptionalUser) -> dict[str, object]:
    """Three messages to choose between. Nothing is sent."""
    account = await require_user(user)
    negotiation = await _owned(negotiation_id, account.uid)
    listing = await get_listing(negotiation.listing_id)

    drafts = await draft_offers(
        current_deposit=negotiation.current_deposit,
        desired_deposit=negotiation.desired_deposit,
        reason=negotiation.reason,
        property_title=listing.title if listing else None,
        rent=listing.rent if listing else None,
    )
    return {
        "drafts": [d.model_dump(mode="json") for d in drafts],
        # Said plainly so an empty list is not read as "the model had no ideas".
        "note": None
        if drafts
        else "No drafts could be generated. Write your own message below.",
    }


@router.post("/{negotiation_id}/send")
async def send_offer(
    negotiation_id: str, body: SendRequest, user: OptionalUser
) -> dict[str, object]:
    """Record an offer and text it to the broker.

    The offer is appended whether or not the SMS goes out, and the response says
    which happened. Losing the record because Twilio was misconfigured would be
    the worse failure — the customer still said the thing.
    """
    account = await require_user(user)
    negotiation = await _owned(negotiation_id, account.uid)
    listing = await get_listing(negotiation.listing_id)

    problem = screen(body.message)
    if problem:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"That message {problem}. Please rephrase it.",
        )

    party = OfferParty.RENTER if account.uid == negotiation.renter_id else OfferParty.BROKER
    offer = NegotiationOffer(
        party=party, amount=body.amount, message=body.message, ai_drafted=body.ai_drafted
    )
    updated = await append_offer(negotiation_id, offer)

    delivery = {"sent": False, "reason": "No number on the listing."}
    if listing and listing.contact_number:
        result = await send_sms(listing.contact_number, body.message)
        delivery = {"sent": result.sent, "reason": result.reason}

    if negotiation.broker_id:
        await create_notification(
            Notification(
                id=new_id("ntf"),
                user_id=negotiation.broker_id,
                type=NotificationType.NEGOTIATION_UPDATE,
                message="A renter sent you a deposit offer.",
                related_id=negotiation_id,
            )
        )

    return {
        "negotiation": updated.model_dump(mode="json") if updated else None,
        "delivery": delivery,
        "sms_configured": sms_available(),
    }


@router.post("/{negotiation_id}/reply")
async def log_reply(
    negotiation_id: str, body: LogReplyRequest, user: OptionalUser
) -> dict[str, object]:
    """Record what the broker said back.

    Typed in by the renter today, because inbound SMS needs a Twilio webhook and
    a number that can receive. The thread is the same either way, and a history
    with the replies typed in beats one with the replies missing.
    """
    account = await require_user(user)
    await _owned(negotiation_id, account.uid)
    updated = await append_offer(
        negotiation_id,
        NegotiationOffer(party=OfferParty.BROKER, amount=body.amount, message=body.message),
    )
    return {"negotiation": updated.model_dump(mode="json") if updated else None}


@router.post("/{negotiation_id}/status")
async def set_status(
    negotiation_id: str, status_value: NegotiationStatus, user: OptionalUser
) -> dict[str, object]:
    account = await require_user(user)
    negotiation = await _owned(negotiation_id, account.uid)
    negotiation.status = status_value
    await save_negotiation(negotiation)
    return {"negotiation": negotiation.model_dump(mode="json")}


@router.get("/{negotiation_id}")
async def read_one(negotiation_id: str, user: OptionalUser) -> dict[str, object]:
    account = await require_user(user)
    negotiation = await _owned(negotiation_id, account.uid)
    return {"negotiation": negotiation.model_dump(mode="json")}


@router.get("")
async def list_mine(user: OptionalUser) -> dict[str, object]:
    account = await require_user(user)
    items = await negotiations_for_user(account.uid, limit=50)
    return {"negotiations": [n.model_dump(mode="json") for n in items]}


@router.get("/listing/{listing_id}")
async def list_for_listing(listing_id: str, user: OptionalUser) -> dict[str, object]:
    account = await require_user(user)
    items = await negotiations_for_listing(listing_id)
    mine = [n for n in items if account.uid in (n.renter_id, n.broker_id)]
    return {"negotiations": [n.model_dump(mode="json") for n in mine]}
