"""Ask a question about one verified listing, answered from its call.

The dashboard used to answer these with a hardcoded keyword match — three
branches and a shrug for everything else, which meant "what is the actual rent?"
got "that wasn't covered on the call" on a call where the rent was stated twice.
This replaces that with the transcript and a model that is only allowed to read
from it.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, status
from pydantic import Field

from app.core.auth import OptionalUser, require_user
from app.llm.listing_chat import answer_about_listing, build_context
from app.models import Base
from app.repositories import (
    calls_for_session,
    get_listing,
    get_session,
    reports_for_session,
)

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/chat", tags=["chat"])


class AskRequest(Base):
    """``POST /api/chat/ask`` body."""

    session_id: str
    listing_id: str
    #: Capped because the whole transcript rides along with every question; an
    #: essay in the box would push the call itself out of the context window.
    user_question: str = Field(min_length=2, max_length=500)


class AskResponse(Base):
    answer: str
    #: False when the call genuinely did not establish this. The UI can style a
    #: "not covered" reply differently from a real answer.
    covered: bool
    quote: str | None = None
    listing_id: str
    transcript_turns: int = 0
    questions_answered: int = 0


@router.post("/ask", response_model=AskResponse)
async def ask(body: AskRequest, user: OptionalUser = None) -> AskResponse:
    """Answer a question about one listing using that listing's call.

    Returns 404 for an unknown session or listing, and 400 when the listing
    belongs to a different search — a listing id from another session would
    otherwise let anyone read a call they did not pay for.
    """
    await require_user(user)

    session = await get_session(body.session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="No such search.")

    listing = await get_listing(body.listing_id)
    if listing is None:
        raise HTTPException(status_code=404, detail="No such listing.")
    if listing.session_id != body.session_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="That listing does not belong to this search.",
        )

    # The most recent completed call wins. A retried number can leave two, and
    # the earlier one is by definition the more stale.
    calls = [c for c in await calls_for_session(body.session_id) if c.listing_id == listing.id]
    calls.sort(key=lambda c: c.created_at, reverse=True)
    call = next((c for c in calls if c.transcript), calls[0] if calls else None)

    report = next(
        (r for r in await reports_for_session(body.session_id) if r.listing_id == listing.id),
        None,
    )

    result = await answer_about_listing(
        question=body.user_question, listing=listing, call=call, report=report
    )
    context = build_context(call)

    log.info(
        "chat: %s asked about %s — covered=%s",
        body.session_id,
        body.listing_id,
        result.covered,
    )

    return AskResponse(
        answer=result.answer,
        covered=result.covered,
        quote=result.quote,
        listing_id=listing.id,
        transcript_turns=context["transcript_turns"],
        questions_answered=context["questions_answered"],
    )
