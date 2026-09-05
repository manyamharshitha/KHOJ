"""Ask a question about one verified listing, answered from its call.

The dashboard used to answer these with a hardcoded keyword match — three
branches and a shrug for everything else, which meant "what is the actual rent?"
got "that wasn't covered on the call" on a call where the rent was stated twice.
This replaces that with the transcript and a model that is only allowed to read
from it.
"""

from __future__ import annotations

import json
import logging

from fastapi import APIRouter, HTTPException, status
from fastapi.responses import StreamingResponse
from pydantic import Field

from app.core.auth import OptionalUser, require_user
from app.llm.listing_chat import (
    answer_about_listing,
    build_context,
    stream_about_listing,
)
from app.models import (
    Base,
    CallLog,
    CallStatus,
    Listing,
    QnAPair,
    Speaker,
    TranscriptTurn,
)
from app.repositories import (
    calls_for_session,
    get_cached_locality,
    get_listing,
    get_session,
    reports_for_session,
)

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/chat", tags=["chat"])


class InlineQnA(Base):
    """One question and answer, supplied by the client."""

    question: str = Field(max_length=400)
    answer: str | None = Field(default=None, max_length=800)


class InlineListing(Base):
    """Just enough of a listing to answer questions about it."""

    title: str | None = Field(default=None, max_length=300)
    locality: str | None = Field(default=None, max_length=200)
    rent: int | None = None
    maintenance: int | None = None
    deposit: int | None = None
    bedrooms: int | None = None
    furnishing: str | None = Field(default=None, max_length=80)


class AskRequest(Base):
    """``POST /api/chat/ask`` body.

    Two ways to identify what is being asked about. Normally the ids resolve to
    a real search and a real call. But the dashboard also renders a bundled
    sample set before anyone has run a search, and those cards carry their own
    question-and-answer content — so a client may instead send that inline and
    get a genuinely generated answer rather than a canned refusal.
    """

    session_id: str | None = None
    listing_id: str | None = None
    #: Supplied when the ids do not exist in the database.
    listing: InlineListing | None = None
    qna: list[InlineQnA] | None = Field(default=None, max_length=40)
    #: Capped because the whole transcript rides along with every question; an
    #: essay in the box would push the call itself out of the context window.
    user_question: str = Field(min_length=2, max_length=500)


class AskResponse(Base):
    answer: str
    #: False when the call genuinely did not establish this. The UI can style a
    #: "not covered" reply differently from a real answer.
    covered: bool
    quote: str | None = None
    listing_id: str | None = None
    #: True when the answer came from client-supplied sample content rather
    #: than a real call, so the UI can label it.
    sample: bool = False
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

    listing = (
        await get_listing(body.listing_id) if body.listing_id else None
    )

    # Sample path: the ids are not in the database, but the client sent the
    # card's own content. Answer from that rather than refusing — the question
    # is real even when the listing is a fixture.
    if listing is None:
        if not (body.listing or body.qna):
            raise HTTPException(status_code=404, detail="No such listing.")
        return await _answer_inline(body)

    session = await get_session(body.session_id) if body.session_id else None
    if session is None:
        raise HTTPException(status_code=404, detail="No such search.")
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
        question=body.user_question,
        listing=listing,
        call=call,
        report=report,
        locality=await _locality_for(listing),
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


async def _answer_inline(body: AskRequest) -> AskResponse:
    """Answer from client-supplied sample content.

    The question-and-answer pairs are replayed as a two-speaker transcript so
    the same grounded path runs: the model still may not answer beyond what is
    in front of it, and the quote it cites is still checked against that text.
    Sample content gets a real answer, not a relaxed one.
    """
    inline = body.listing or InlineListing()
    listing = Listing(
        id=body.listing_id or "sample",
        session_id=body.session_id or "sample",
        source_site="Sample data",
        title=inline.title,
        locality=inline.locality,
        rent=inline.rent,
        maintenance=inline.maintenance,
        deposit=inline.deposit,
        bedrooms=inline.bedrooms,
        furnishing=inline.furnishing,
    )

    turns: list[TranscriptTurn] = []
    pairs: list[QnAPair] = []
    for index, item in enumerate(body.qna or []):
        turns.append(
            TranscriptTurn(speaker=Speaker.AGENT, text=item.question, timestamp=float(index * 2))
        )
        if item.answer:
            turns.append(
                TranscriptTurn(
                    speaker=Speaker.OWNER, text=item.answer, timestamp=float(index * 2 + 1)
                )
            )
        pairs.append(QnAPair(question=item.question, answer=item.answer))

    call = CallLog(
        id="sample",
        session_id=listing.session_id,
        listing_id=listing.id,
        phone_dialed="+910000000000",
        call_status=CallStatus.COMPLETED,
        transcript=turns,
        qna_pairs=pairs,
    )

    result = await answer_about_listing(
        question=body.user_question, listing=listing, call=call, report=None
    )
    log.info("chat: sample-data question answered — covered=%s", result.covered)

    return AskResponse(
        answer=result.answer,
        covered=result.covered,
        quote=result.quote,
        listing_id=body.listing_id,
        sample=True,
        transcript_turns=len(turns),
        questions_answered=sum(1 for p in pairs if p.answer),
    )


async def _locality_for(listing: Listing) -> dict[str, object] | None:
    """Cached neighbourhood notes for this listing's area, if any.

    Cache-only on purpose. Fetching Reddit and summarising it takes seconds, and
    a chat box must answer now — the locality endpoint warms this cache, and
    until it has, area questions honestly say the discussion was not found.
    """
    if not listing.locality:
        return None
    try:
        return await get_cached_locality(listing.locality, None)
    except Exception:  # noqa: BLE001 - context is optional, never fatal
        log.exception("chat: could not read locality cache")
        return None


async def _resolve(body: AskRequest) -> tuple[Listing, CallLog | None, object | None]:
    """The listing, its most recent call with speech, and its honesty report.

    Falls back to the client-supplied sample content when the ids are not in the
    database, so the bundled demo cards stream too.
    """
    listing = await get_listing(body.listing_id) if body.listing_id else None

    if listing is None:
        inline = body.listing or InlineListing()
        listing = Listing(
            id=body.listing_id or "sample",
            session_id=body.session_id or "sample",
            source_site="Sample data",
            title=inline.title,
            locality=inline.locality,
            rent=inline.rent,
            maintenance=inline.maintenance,
            deposit=inline.deposit,
            bedrooms=inline.bedrooms,
            furnishing=inline.furnishing,
        )
        turns: list[TranscriptTurn] = []
        for index, item in enumerate(body.qna or []):
            turns.append(
                TranscriptTurn(
                    speaker=Speaker.AGENT, text=item.question, timestamp=float(index * 2)
                )
            )
            if item.answer:
                turns.append(
                    TranscriptTurn(
                        speaker=Speaker.OWNER,
                        text=item.answer,
                        timestamp=float(index * 2 + 1),
                    )
                )
        call = CallLog(
            id="sample",
            session_id=listing.session_id,
            listing_id=listing.id,
            phone_dialed="+910000000000",
            call_status=CallStatus.COMPLETED,
            transcript=turns,
        )
        return listing, call, None

    calls = [
        c for c in await calls_for_session(listing.session_id) if c.listing_id == listing.id
    ]
    calls.sort(key=lambda c: c.created_at, reverse=True)
    call = next((c for c in calls if c.transcript), calls[0] if calls else None)
    report = next(
        (
            r
            for r in await reports_for_session(listing.session_id)
            if r.listing_id == listing.id
        ),
        None,
    )
    return listing, call, report


@router.post("/stream")
async def ask_streaming(body: AskRequest, user: OptionalUser = None) -> StreamingResponse:
    """The same answer as ``/ask``, streamed as it is generated.

    Server-sent events. Two event shapes reach the client:

    ``{"delta": "..."}``  more text
    ``{"done": true, "intent": ..., "covered": ..., "verified": ...}``

    ``verified`` is the part that matters. The quote check can only run on a
    finished sentence, so a listing answer arrives before it has been checked;
    if it turns out to cite words the broker never said, the final event says so
    and the client must replace what it displayed. ``/ask`` remains available
    for callers that would rather wait and never show an unchecked claim.
    """
    await require_user(user)
    listing, call, report = await _resolve(body)
    locality = await _locality_for(listing)

    async def events():
        try:
            async for event in stream_about_listing(
                question=body.user_question,
                listing=listing,
                call=call,
                report=report,
                locality=locality,
            ):
                yield f"data: {json.dumps(event)}\n\n"
        except Exception:  # noqa: BLE001 - a dead stream must still close cleanly
            log.exception("chat: stream failed")
            yield 'data: {"done": true, "error": "The answer could not be completed."}\n\n'

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            # Without this, a proxy will buffer the whole response and hand it
            # over at the end — which is exactly the latency being removed.
            "X-Accel-Buffering": "no",
        },
    )
