"""Outbound SMS, through Twilio when it is configured.

Every function here returns a result rather than raising, and reports honestly
when no credentials are present. A text message that was never sent must never
be recorded as sent: the whole site-visit flow hangs off "we asked the broker at
14:00", and a silent failure there produces a verification that expires blaming
a broker who was never contacted.

Nothing in this module retries. A phone message is not idempotent — a retry that
duplicates is worse than one that fails visibly.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from app.config import settings

log = logging.getLogger(__name__)


@dataclass(slots=True)
class SmsResult:
    """What happened when a message was attempted."""

    sent: bool
    #: Twilio's message SID when it went out, for reconciling against their logs.
    provider_id: str | None = None
    #: Why not, in words a person can act on. Empty when it was sent.
    reason: str = ""


def sms_available() -> bool:
    """True when there are credentials and a sending number."""
    return bool(
        settings.twilio_account_sid
        and settings.twilio_auth_token
        and settings.twilio_from_number
    )


async def send_sms(to_e164: str, body: str) -> SmsResult:
    """Send one message. Never raises.

    ``to_e164`` must already be E.164 — normalisation lives in
    ``app.llm.extractor.to_e164`` so there is one definition of a dialable
    number rather than two that can disagree.
    """
    if not to_e164:
        return SmsResult(False, reason="No number to send to.")

    if not sms_available():
        # Loud, because the caller is about to record a status. In development
        # this is the normal path and the message is still worth seeing.
        log.warning(
            "sms: not configured (TWILIO_ACCOUNT_SID / AUTH_TOKEN / FROM_NUMBER) - "
            "would have sent to %s: %s",
            to_e164,
            body[:120],
        )
        return SmsResult(False, reason="SMS is not configured on this server.")

    try:
        from twilio.rest import Client  # imported late: optional dependency
    except ImportError:
        log.error("sms: twilio is not installed. pip install twilio")
        return SmsResult(False, reason="The Twilio SDK is not installed.")

    try:
        client = Client(settings.twilio_account_sid, settings.twilio_auth_token)
        # The SDK is synchronous; run it off the event loop so a slow Twilio
        # response cannot stall every other request this server is serving.
        import anyio

        message = await anyio.to_thread.run_sync(
            lambda: client.messages.create(
                to=to_e164, from_=settings.twilio_from_number, body=body
            )
        )
    except Exception as exc:  # noqa: BLE001 - normalise every provider error
        log.warning("sms: send to %s failed (%s)", to_e164, exc)
        return SmsResult(False, reason=f"The message could not be sent: {str(exc)[:120]}")

    log.info("sms: sent %s to %s", message.sid, to_e164)
    return SmsResult(True, provider_id=message.sid)
