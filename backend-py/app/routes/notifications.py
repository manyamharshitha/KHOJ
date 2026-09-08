"""Notifications, and a stream to push them down.

Server-sent events rather than Socket.io. The spec asks for WebSockets, but
every notification here travels server to client and none travels back, which is
exactly what SSE is for: it rides on plain HTTP, survives proxies that mangle
upgrade headers, and reconnects on its own. The frontend already speaks SSE for
chat streaming, so this adds no new client dependency.

Delivery is at-most-once and the stream is not a queue. Anything that matters is
written to the database first and read back on connect, so a customer who was
offline does not simply miss it.
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import AsyncIterator

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse

from app.core.auth import OptionalUser, require_user
from app.models import Notification, NotificationType
from app.repositories import (
    count_unread,
    create_notification,
    mark_all_read,
    mark_notification_read,
    new_id,
    notifications_for_user,
)

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/notifications", tags=["notifications"])

#: How often the stream looks for new rows. A notification is not a chat token —
#: three seconds is imperceptible for "your call transcript is ready" and costs
#: one indexed count query per connected client.
_POLL_SECONDS = 3.0

#: Keep-alive interval. Proxies close idle connections; a comment frame costs
#: nothing and stops the browser reconnecting every 60 seconds.
_HEARTBEAT_SECONDS = 25.0


async def notify(
    user_id: str, type_: NotificationType, message: str, related_id: str | None = None
) -> str | None:
    """Create one notification. Never raises.

    Called from inside other flows — a call completing, a visit being verified —
    where a failure to notify must not fail the thing being notified about.
    """
    # Only a genuinely absent id is skipped. "anonymous" is excluded elsewhere
    # in this codebase because it must not accrue quota or call history, but it
    # is a real single user when AUTH_REQUIRED is off — filtering it here made
    # the bell permanently empty in development, which reads as a broken
    # feature rather than as an unauthenticated one.
    if not user_id:
        return None
    try:
        return await create_notification(
            Notification(
                id=new_id("ntf"),
                user_id=user_id,
                type=type_,
                message=message,
                related_id=related_id,
            )
        )
    except Exception:  # noqa: BLE001 - the underlying event still happened
        log.exception("notifications: could not record %s for %s", type_.value, user_id)
        return None


@router.get("")
async def list_mine(user: OptionalUser, unread_only: bool = False) -> dict[str, object]:
    account = await require_user(user)
    items = await notifications_for_user(account.uid, unread_only=unread_only, limit=50)
    return {
        "notifications": [n.model_dump(mode="json") for n in items],
        "unread": await count_unread(account.uid),
    }


@router.post("/{notification_id}/read")
async def read_one(notification_id: str, user: OptionalUser) -> dict[str, object]:
    account = await require_user(user)
    if not await mark_notification_read(notification_id, account.uid):
        raise HTTPException(status_code=404, detail="No such notification.")
    return {"ok": True, "unread": await count_unread(account.uid)}


@router.post("/read-all")
async def read_all(user: OptionalUser) -> dict[str, object]:
    account = await require_user(user)
    return {"marked": await mark_all_read(account.uid), "unread": 0}


@router.get("/stream")
async def stream(request: Request, user: OptionalUser) -> StreamingResponse:
    """Push new notifications as they appear.

    The client is told the current unread count on connect, then only about
    changes. Disconnect ends the loop — without the request.is_disconnected
    check a closed tab would leave this polling the database forever.
    """
    account = await require_user(user)

    async def events() -> AsyncIterator[str]:
        seen: set[str] = {n.id for n in await notifications_for_user(account.uid, limit=50)}
        yield f"event: ready\ndata: {json.dumps({'unread': await count_unread(account.uid)})}\n\n"

        idle = 0.0
        while True:
            if await request.is_disconnected():
                return

            try:
                fresh = [
                    n
                    for n in await notifications_for_user(account.uid, limit=20)
                    if n.id not in seen
                ]
            except Exception:  # noqa: BLE001 - a blip must not kill the stream
                log.exception("notifications: stream poll failed for %s", account.uid)
                fresh = []

            for note in reversed(fresh):  # oldest first, so they arrive in order
                seen.add(note.id)
                yield f"event: notification\ndata: {json.dumps(note.model_dump(mode='json'))}\n\n"
                idle = 0.0

            if idle >= _HEARTBEAT_SECONDS:
                yield ": keep-alive\n\n"
                idle = 0.0

            await asyncio.sleep(_POLL_SECONDS)
            idle += _POLL_SECONDS

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            # Nginx buffers text/event-stream by default, which holds every
            # event until the buffer fills - i.e. defeats the whole point.
            "X-Accel-Buffering": "no",
        },
    )
