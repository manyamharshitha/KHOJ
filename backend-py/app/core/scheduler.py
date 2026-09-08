"""The background loop that sends site-visit requests when they fall due.

A visit is booked for a time the broker agreed to. Something has to notice that
the time has arrived, and until now that was a human calling ``/send`` by hand —
which works for a demo and not for anything else.

Deliberately a single in-process loop rather than Celery or APScheduler: this
polls one indexed query every thirty seconds and the service already runs as one
process. The cost of that choice is stated rather than hidden — **two instances
of this server will both send the same SMS.** The claim is guarded by moving the
row out of SCHEDULED before sending, which narrows the window to the gap between
the read and the write but does not close it. A real fix is a findAndModify
claim or an external queue, and is the first thing to do here if this ever runs
on more than one instance.
"""

from __future__ import annotations

import asyncio
import logging

from app.config import settings
from app.core.sms import send_sms, sms_available
from app.models import SiteVisitStatus, utcnow
from app.repositories import (
    due_site_visits,
    issue_visit_token,
    token_for_visit,
    update_site_visit,
)

log = logging.getLogger(__name__)

#: How often to look. A minute either side of the agreed time is imperceptible
#: to a person waiting for a text, and this is one indexed count query.
POLL_SECONDS = 30.0


async def _dispatch_one(visit) -> bool:  # type: ignore[no-untyped-def]
    """Send one request. True if the SMS actually left."""
    token = await token_for_visit(visit.id) or await issue_visit_token(visit.id)
    link = f"{settings.public_base_url.rstrip('/')}/verify/{token}"
    address = visit.property_address or "the property"

    result = await send_sms(
        visit.broker_phone,
        f"Khoj: a prospective tenant has asked for a short live video from {address}. "
        f"Please open this link and record 2 minutes now: {link}",
    )

    if result.sent:
        await update_site_visit(
            visit.id, status=SiteVisitStatus.SMS_SENT.value, sms_sent_at=utcnow()
        )
        log.info("scheduler: sent visit request %s to %s", visit.id, visit.broker_phone)
        return True

    # Left in SCHEDULED on purpose, so the next tick retries. A visit that was
    # never asked for must not sit there looking as though the broker ignored it.
    log.warning("scheduler: could not send %s - %s", visit.id, result.reason)
    return False


async def _tick() -> int:
    """One pass. Returns how many requests went out."""
    visits = await due_site_visits()
    if not visits:
        return 0

    if not sms_available():
        # Once per tick, not once per visit: an unconfigured server would
        # otherwise fill the log with the same line for every pending row.
        log.warning(
            "scheduler: %d visit(s) are due but SMS is not configured", len(visits)
        )
        return 0

    sent = 0
    for visit in visits:
        try:
            sent += await _dispatch_one(visit)
        except Exception:  # noqa: BLE001 - one bad row must not stop the loop
            log.exception("scheduler: dispatching %s failed", visit.id)
    return sent


async def run_forever() -> None:
    """Poll until cancelled. Never raises out of the loop.

    Every failure is swallowed and retried on the next tick. A scheduler that
    dies on the first transient database blip is worse than no scheduler: the
    service keeps serving requests and nobody notices the texts stopped.
    """
    log.info("scheduler: watching for due site visits every %.0fs", POLL_SECONDS)
    while True:
        try:
            await _tick()
        except asyncio.CancelledError:
            log.info("scheduler: stopping")
            raise
        except Exception:  # noqa: BLE001 - keep the loop alive
            log.exception("scheduler: tick failed")
        await asyncio.sleep(POLL_SECONDS)
