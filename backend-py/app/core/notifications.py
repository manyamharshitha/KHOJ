"""Admin notifications for custom agency leads.

Two channels, both optional and tried independently: a Slack/Discord-style
webhook, and transactional email through Resend. Whichever is configured fires;
if both are, both fire; if neither is, the lead is still stored and the miss is
logged loudly.

A notification failure never fails the request. Someone who has just typed their
email into a "contact us" box should see it accepted — the lead is already
durable in Firestore, and a dropped webhook is an operations problem, not their
problem.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

import httpx

from app.config import settings

log = logging.getLogger(__name__)

_TIMEOUT = 10.0


@dataclass(slots=True)
class DispatchResult:
    """Which channels actually delivered."""

    webhook: bool | None = None  # None = not configured
    email: bool | None = None

    @property
    def delivered(self) -> bool:
        return bool(self.webhook) or bool(self.email)

    @property
    def configured(self) -> bool:
        return self.webhook is not None or self.email is not None

    def summary(self) -> str:
        if not self.configured:
            return "no notification channel configured"
        parts = []
        if self.webhook is not None:
            parts.append(f"webhook={'sent' if self.webhook else 'failed'}")
        if self.email is not None:
            parts.append(f"email={'sent' if self.email else 'failed'}")
        return ", ".join(parts)


def _slack_style_payload(title: str, lines: list[str]) -> dict[str, object]:
    """A body both Slack and Discord accept.

    Both read ``content``/``text`` as the plain fallback, so one shape covers
    either without sniffing the URL.
    """
    body = f"**{title}**\n" + "\n".join(lines)
    return {"text": body, "content": body}


async def _post_webhook(title: str, lines: list[str]) -> bool:
    url = settings.admin_notification_webhook_url
    if not url:
        return False
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            response = await client.post(url, json=_slack_style_payload(title, lines))
        if response.status_code >= 300:
            log.error("notify: webhook returned HTTP %d — %s", response.status_code, response.text[:200])
            return False
        return True
    except Exception as exc:  # noqa: BLE001 - any transport failure is the same outcome
        log.error("notify: webhook failed (%s)", exc)
        return False


async def _send_email(subject: str, lines: list[str]) -> bool:
    """Transactional email via Resend.

    Chosen over raw SMTP because it needs one API key rather than a mail server,
    and because SMTP from a container is usually blocked anyway.
    """
    if not (settings.resend_api_key and settings.admin_notification_email):
        return False

    html = "<br>".join(lines)
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            response = await client.post(
                "https://api.resend.com/emails",
                headers={"Authorization": f"Bearer {settings.resend_api_key}"},
                json={
                    "from": settings.notification_from_email,
                    "to": [settings.admin_notification_email],
                    "subject": subject,
                    "html": f"<p>{html}</p>",
                },
            )
        if response.status_code >= 300:
            log.error("notify: resend returned HTTP %d — %s", response.status_code, response.text[:200])
            return False
        return True
    except Exception as exc:  # noqa: BLE001
        log.error("notify: email failed (%s)", exc)
        return False


async def notify_custom_agency_lead(
    *, email: str, notes: str | None = None, source: str | None = None, lead_id: str
) -> DispatchResult:
    """Alert the team that someone wants more than the Premium plan allows.

    This is a warm inbound lead from someone who has already hit a paid ceiling,
    so it is worth a real alert rather than a row in a table nobody reads.
    """
    title = f"New Custom Agency Plan Request from {email}"
    lines = [f"Email: {email}", f"Lead: {lead_id}"]
    if notes:
        lines.append(f"Notes: {notes[:500]}")
    if source:
        lines.append(f"Source: {source}")

    result = DispatchResult(
        webhook=await _post_webhook(title, lines)
        if settings.admin_notification_webhook_url
        else None,
        email=await _send_email(title, lines)
        if (settings.resend_api_key and settings.admin_notification_email)
        else None,
    )

    if not result.configured:
        # Loud, because a lead capture nobody is told about is a lead lost.
        log.warning(
            "notify: %s — but no channel is configured. Set "
            "ADMIN_NOTIFICATION_WEBHOOK_URL or RESEND_API_KEY + ADMIN_NOTIFICATION_EMAIL.",
            title,
        )
    elif not result.delivered:
        log.error("notify: every channel failed for lead %s", lead_id)
    else:
        log.info("notify: %s (%s)", title, result.summary())

    return result
