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


def whatsapp_handoff_url(to_e164: str, body: str) -> str:
    """A wa.me link that opens WhatsApp with this message ready to send.

    The answer when no gateway is available, and arguably the better one anyway.

    A messaging API is the wrong shape for this problem three times over: a
    Twilio trial cannot text a number nobody has verified, an Indian SMS route
    needs DLT registration that takes weeks and a registered company, and a
    WhatsApp sandbox needs the broker to send a join code, which no real broker
    will ever do. All three block the same thing — reaching an arbitrary number
    somebody just typed in.

    This has none of those limits because there is no gateway. The customer taps
    it, her own WhatsApp opens with the broker's number and the message filled
    in, and she presses send. It costs nothing, needs no account, and works with
    any number in any country.

    It is also better received. The broker gets a message from a person whose
    profile they can see, rather than a link from a shortcode they have never
    heard of — which is exactly what a wary broker ignores.

    The one thing it is not is automatic: it needs a human to press send. That
    is what a paid gateway buys.
    """
    from urllib.parse import quote

    return f"https://wa.me/{to_e164.lstrip('+')}?text={quote(body)}"


def sms_available() -> bool:
    """True when there are credentials and something to send from.

    Either sender counts. WhatsApp is listed first because it is the one that
    actually delivers to an Indian number without weeks of DLT paperwork.
    """
    return bool(
        settings.twilio_account_sid
        and settings.twilio_auth_token
        and (settings.twilio_whatsapp_from or settings.twilio_from_number)
    )


def _route(to_e164: str) -> tuple[str, str, str]:
    """Sender, recipient and a word for the log, for whichever channel is set.

    WhatsApp wins when both are configured. Twilio addresses it by prefixing
    both numbers with `whatsapp:`, and mixing the prefixes — a plain `from` with
    a `whatsapp:` `to` — fails with an error that names neither.
    """
    if settings.twilio_whatsapp_from:
        sender = settings.twilio_whatsapp_from
        if not sender.startswith("whatsapp:"):
            sender = f"whatsapp:{sender}"
        return sender, f"whatsapp:{to_e164}", "whatsapp"
    return settings.twilio_from_number or "", to_e164, "sms"


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

    sender, recipient, channel = _route(to_e164)

    try:
        client = Client(settings.twilio_account_sid, settings.twilio_auth_token)
        # The SDK is synchronous; run it off the event loop so a slow Twilio
        # response cannot stall every other request this server is serving.
        import anyio

        message = await anyio.to_thread.run_sync(
            lambda: client.messages.create(to=recipient, from_=sender, body=body)
        )
    except Exception as exc:  # noqa: BLE001 - normalise every provider error
        text = str(exc)
        log.warning("%s: send to %s failed (%s)", channel, to_e164, text[:200])

        # Two failures worth naming, because the generic message sends people
        # looking for a bug in this file rather than at their Twilio console.
        if "Trial accounts can only use predefined" in text or "Invalid template name" in text:
            # A trial account cannot send arbitrary text on either channel, and
            # cannot reach a number nobody has verified. Both are Twilio account
            # limits with no code-side answer, and the message Twilio returns
            # blames a template the caller never supplied — which reads as a bug
            # here rather than as a billing state there.
            return SmsResult(
                False,
                reason=(
                    "This Twilio account is still on trial, and trials may only "
                    "send fixed template text to numbers you have verified. "
                    "Upgrading the account is the only way to send a real "
                    "verification link to an arbitrary broker."
                ),
            )
        if "ContentSid" in text or "63016" in text:
            # WhatsApp only allows free text inside a 24-hour window that the
            # *recipient* opens by messaging you. Outside it, Twilio demands a
            # pre-approved template and refuses the body entirely.
            #
            # In practice this always means the same thing: nobody has joined
            # the sandbox from that handset. Twilio's own wording names a field
            # rather than the cause, which sends people hunting for a parameter
            # they were right not to send.
            return SmsResult(
                False,
                reason=(
                    f"WhatsApp will not accept a free-text message to {to_e164} "
                    "because that number has no open conversation. Send the "
                    "sandbox join phrase from that handset first — Twilio "
                    "console, Messaging, Try it out, Send a WhatsApp message — "
                    "then this works for 24 hours after their last reply."
                ),
            )
        if "63007" in text or "not a valid WhatsApp" in text:
            return SmsResult(
                False,
                reason=(
                    "WhatsApp sender is not set up. In the Twilio sandbox the "
                    "recipient must first send the join code to the sandbox number."
                ),
            )
        if "21608" in text or "unverified" in text.lower():
            return SmsResult(
                False,
                reason=(
                    "This number is not verified on your Twilio trial account. "
                    "Verify it in the console, or upgrade the account."
                ),
            )
        return SmsResult(False, reason=f"The message could not be sent: {text[:120]}")

    log.info("%s: sent %s to %s", channel, message.sid, to_e164)
    return SmsResult(True, provider_id=message.sid)
