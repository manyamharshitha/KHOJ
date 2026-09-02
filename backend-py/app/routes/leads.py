"""Custom agency lead capture.

"Need more than 25 a day? Leave your email and we'll set up a custom agency
plan." This is the endpoint behind that box.

The order matters: **store first, notify second.** A lead is durable in
Firestore before any webhook is attempted, so a Slack outage costs a delayed
alert rather than a lost customer. Notification failures are recorded on the
lead document, never returned as an error — someone who has just typed their
email into a contact box should see it accepted.
"""

from __future__ import annotations

import logging
from typing import Annotated

from fastapi import APIRouter, Header, Request, status

from app.core.notifications import notify_custom_agency_lead
from app.core.plans import CUSTOM_AGENCY_THRESHOLD, plan_catalogue
from app.core.auth import OptionalUser
from app.firebase import get_db
from app.ids import new_id
from app.models import AgencyLead, AgencyLeadRequest

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["plans"])

AGENCY_LEADS = "agency_leads"


@router.get("/plans")
async def plans() -> dict[str, object]:
    """The pricing table, and where the custom flow begins."""
    return {
        "plans": plan_catalogue(),
        "custom_agency_threshold": CUSTOM_AGENCY_THRESHOLD,
        "custom_agency_prompt": (
            f"Need more than {CUSTOM_AGENCY_THRESHOLD} a day? Leave your email and "
            "we'll set up a custom agency plan."
        ),
    }


@router.post("/leads/custom-agency", status_code=status.HTTP_201_CREATED)
async def custom_agency_lead(
    body: AgencyLeadRequest,
    request: Request,
    user: OptionalUser = None,
    user_agent: Annotated[str | None, Header()] = None,
) -> dict[str, object]:
    """Capture someone who needs more than the top plan allows.

    Accepts anonymously — the person may not have signed up yet, and forcing a
    login in front of a "talk to us about money" box loses the lead.
    """
    lead = AgencyLead(
        id=new_id("lead"),
        email=body.email,
        notes=body.notes,
        uid=user.uid if user else None,
        source=body.source or "pricing_page",
        user_agent=(user_agent or "")[:300] or None,
    )

    # Durable first. Everything after this is best-effort.
    await get_db().collection(AGENCY_LEADS).document(lead.id).set(
        {k: v for k, v in lead.to_firestore().items() if k != "id"}
    )
    log.info("lead: custom agency request from %s (%s)", lead.email, lead.id)

    result = await notify_custom_agency_lead(
        email=lead.email, notes=lead.notes, source=lead.source, lead_id=lead.id
    )

    try:
        await get_db().collection(AGENCY_LEADS).document(lead.id).update(
            {"notified": result.delivered, "notification_detail": result.summary()}
        )
    except Exception:  # noqa: BLE001 - bookkeeping must not fail the request
        log.exception("lead: could not record notification status for %s", lead.id)

    return {
        "ok": True,
        "lead_id": lead.id,
        "message": "Thanks — we'll be in touch about a custom agency plan shortly.",
    }
