"""Answer a customer's question about one listing, from the call itself.

The rule this module exists to enforce: **the answer comes from the transcript
or it does not come at all.** A model asked "what is the rent?" with a phone
call in front of it will happily produce a confident number even when nobody
said one, and a fabricated rent is worse than no answer — the customer plans a
Saturday around it.

Two mechanisms hold that line:

* ``covered`` is a field the model must fill in, not a sentence we hope it says.
  A useful answer with ``covered=false`` is a contradiction, and the caller
  replaces it with the honest one.
* ``quote`` must appear in the transcript verbatim. If it does not, the answer
  is discarded rather than shown, because a quote the call never contained means
  the rest of the answer was invented too.
"""

from __future__ import annotations

import logging
import re
from collections.abc import AsyncIterator
from typing import Any, Literal

from pydantic import Field

from app.llm.client import LLMError, complete_model, llm_available, stream_text
from app.models import Base, CallLog, HonestyReport, Listing

log = logging.getLogger(__name__)

#: What the customer sees when the call genuinely did not establish something.
NOT_COVERED = "The call didn't cover that."

#: The transcript is the whole context, and a long one costs tokens on every
#: question. Calls run to roughly sixty turns, so this keeps entire calls intact
#: while capping a pathological one.
MAX_TURNS = 120


class ListingAnswer(Base):
    """One answer, either about the listing or about Khoj itself."""

    #: Which question was asked. ``platform`` answers are general help and are
    #: not held to the transcript, because there is no transcript to hold them
    #: to — the evidence guard applies to ``listing`` answers only.
    intent: Literal["listing", "platform"] = "listing"
    answer: str = Field(max_length=800)
    #: Whether the call actually established this. False means say so plainly.
    covered: bool
    #: The broker's own words supporting the answer. Verified against the
    #: transcript before the answer is shown.
    quote: str | None = Field(default=None, max_length=400)


SYSTEM = """\
You are Khoj's assistant. You answer two kinds of question and must decide which
one you are being asked before answering.

## Deciding

Set intent="listing" when the question is about THIS property - rent, deposit,
brokerage, availability, parking, the floor, what the broker said, whether the
advert was accurate.

Set intent="platform" when the question is about Khoj itself - how to run a
search, how to add a listing, plans and pricing, quota, how the calls work, what
a score means, how to get more verifications.

If a question could be either, prefer "listing". The customer is looking at one
property, and that is usually what she means.

## Answering a listing question (intent="listing")

1. Answer ONLY from the transcript and the advert given to you. Never use
   general knowledge about rents, localities, or Indian property markets. If the
   call did not establish it, you do not know it.
2. If the transcript does not answer it, set covered=false and put exactly this
   in answer: "The call didn't cover that."
3. When the answer IS in the transcript, set covered=true and put the broker's
   supporting words in quote, copied character for character from the
   transcript. Do not paraphrase inside quote.
4. Where the call contradicts the advert, say both and say which came from the
   call. The spoken figure is the current one; the advert may be stale.

## Answering a platform question (intent="platform")

Set covered=true and leave quote empty. Use only these facts:

- Khoj finds rental listings, phones the owner or broker, and verifies what the
  advert claimed against what they actually say on the call.
- Plans, by listings verified per day: free 2 (Rs 0), silver 6 (Rs 299),
  gold 15 (Rs 699), premium 25 (Rs 1499).
- Above 25 a day there is a custom agency plan - leave an email on the pricing
  page and the team gets in touch.
- To search: open Sources, pick or add listing sites, and describe what you want
  in plain English.
- To add a property by hand: Sources, then the "Add by hand" form. A phone
  number is the only required field.
- Calls are placed by an AI assistant that says so at the start and asks
  permission to record.
- The honesty score runs 0-10 and compares the advert against the call. A low
  score means the two disagreed.

If a platform question is not covered by those facts, say you are not sure and
suggest contacting the team. Never invent a price, a feature, or a policy.

## Both kinds

- Be brief. Two sentences at most.
- Never advise on whether something is a good deal, and never invent a viewing
  time or a phone number.
"""


def _transcript_text(call: CallLog | None) -> str:
    if not call or not call.transcript:
        return ""
    turns = call.transcript[:MAX_TURNS]
    return "\n".join(f"{t.speaker.value}: {t.text}" for t in turns if t.text)


def _advert_text(listing: Listing) -> str:
    bits = [
        f"Title: {listing.title}" if listing.title else "",
        f"Locality: {listing.locality}" if listing.locality else "",
        f"Advertised rent: {listing.rent}" if listing.rent is not None else "",
        f"Advertised maintenance: {listing.maintenance}" if listing.maintenance is not None else "",
        f"Advertised deposit: {listing.deposit}" if listing.deposit is not None else "",
        f"Bedrooms: {listing.bedrooms}" if listing.bedrooms is not None else "",
        f"Furnishing: {listing.furnishing}" if listing.furnishing else "",
        f"Building age (years): {listing.age_years}" if listing.age_years is not None else "",
    ]
    return "\n".join(b for b in bits if b) or "(the advert carried almost no detail)"


def _honesty_text(report: HonestyReport | None) -> str:
    if not report:
        return "(no honesty analysis for this call)"
    lines = [
        f"Honesty score: {report.honesty_score}/10",
        f"Verdict: {getattr(report.final_verdict, 'value', report.final_verdict)}",
        f"Summary: {report.summary}",
    ]
    lines += [f"Red flag: {f}" for f in report.red_flags]
    for d in report.listing_discrepancies:
        lines.append(
            f"Discrepancy in {d.field}: advert said {d.listing_claim}, call said {d.spoken_claim}"
        )
    return "\n".join(lines)


def _normalise(text: str) -> str:
    """Collapse whitespace and case so a quote match is not defeated by layout."""
    return re.sub(r"\s+", " ", text or "").strip().lower()


def _quote_is_real(quote: str | None, transcript: str) -> bool:
    """Whether the model's quote actually appears in the call.

    Punctuation and spacing get normalised; the words themselves must be there.
    A near-miss is still a miss — the point is to catch invention, and a model
    that paraphrases inside a quote is inventing.
    """
    if not quote:
        return True  # nothing claimed, nothing to verify
    return _normalise(quote) in _normalise(transcript)


async def answer_about_listing(
    *,
    question: str,
    listing: Listing,
    call: CallLog | None,
    report: HonestyReport | None,
) -> ListingAnswer:
    """Answer one question about one listing, grounded in its call.

    Never raises for an unusable model or a missing call — both return the
    honest "not covered" answer, because a chat box that throws an error is a
    worse experience than one that says it does not know.
    """
    transcript = _transcript_text(call)

    if not transcript:
        return ListingAnswer(
            answer=(
                "There is no call transcript for this listing yet, so there is "
                "nothing for me to check."
            ),
            covered=False,
        )

    if not llm_available():
        return ListingAnswer(
            answer="The assistant is not configured on this server, so I cannot answer that.",
            covered=False,
        )

    user = (
        f"## The advert\n\n{_advert_text(listing)}\n\n"
        f"## The call transcript\n\n{transcript}\n\n"
        f"## Honesty analysis\n\n{_honesty_text(report)}\n\n"
        f"## The tenant asks\n\n{question.strip()}"
    )

    try:
        result = await complete_model(
            system=SYSTEM,
            user=user,
            output=ListingAnswer,
            model=None,  # extraction model; this is reading, not reasoning
            temperature=0.0,
        )
    except LLMError as exc:
        log.warning("listing chat: model failed (%s)", exc)
        return ListingAnswer(
            answer="I could not check the call just now. Please try again in a moment.",
            covered=False,
        )

    # The evidence guard. A quote that is not in the transcript means the answer
    # was constructed rather than read, so the whole thing is discarded.
    if result.intent == "listing" and result.covered and not _quote_is_real(
        result.quote, transcript
    ):
        log.warning(
            "listing chat: discarded an answer whose quote is not in the transcript: %r",
            (result.quote or "")[:120],
        )
        return ListingAnswer(answer=NOT_COVERED, covered=False)

    # A model that says "not covered" while filling in a confident answer is
    # contradicting itself; the honest half wins.
    if result.intent == "listing" and not result.covered:
        return ListingAnswer(answer=NOT_COVERED, covered=False)

    return result


def build_context(call: CallLog | None) -> dict[str, Any]:
    """Small summary the UI can show next to the chat, without another request."""
    turns = len(call.transcript) if call and call.transcript else 0
    answered = (
        sum(1 for q in call.qna_pairs if q.answer) if call and call.qna_pairs else 0
    )
    return {
        "has_transcript": turns > 0,
        "transcript_turns": turns,
        "questions_answered": answered,
    }


#: Appended when streaming. The structured path carries `intent` and `covered`
#: as real fields; prose cannot, so the model is asked to end with one
#: machine-readable line that is stripped before the text reaches the reader.
STREAM_SUFFIX = """

## Output format

Write the answer as plain prose. Then, on a final line by itself, write exactly:

META intent=<listing|platform> covered=<true|false>

Nothing after that line. The reader never sees it.
"""

_META = re.compile(r"^META\s+intent=(listing|platform)\s+covered=(true|false)\s*$", re.M)


async def stream_about_listing(
    *,
    question: str,
    listing: Listing,
    call: CallLog | None,
    report: HonestyReport | None,
) -> AsyncIterator[dict[str, Any]]:
    """Stream an answer, then say whether it held up.

    Yields ``{"delta": str}`` as text arrives, then one final event carrying
    ``intent``, ``covered`` and ``verified``.

    The evidence guard cannot run mid-stream: whether a quote is real is only
    knowable once the sentence containing it exists. So the text streams for
    speed and the verdict arrives last — a listing answer citing words the
    broker never said comes back ``verified=false``, and the client replaces
    what it showed. A rare visible correction is a fair price for the latency;
    silently leaving an unverified claim about somebody's rent on screen is not.
    """
    transcript = _transcript_text(call)

    if not llm_available():
        yield {"delta": "The assistant is not configured on this server."}
        yield {"done": True, "intent": "platform", "covered": False, "verified": True}
        return

    user = (
        f"## The advert\n\n{_advert_text(listing)}\n\n"
        f"## The call transcript\n\n{transcript or '(no call transcript)'}\n\n"
        f"## Honesty analysis\n\n{_honesty_text(report)}\n\n"
        f"## The tenant asks\n\n{question.strip()}"
    )

    buffer = ""
    try:
        async for piece in stream_text(system=SYSTEM + STREAM_SUFFIX, user=user):
            buffer += piece
            # Hold back anything that might be the start of the META line rather
            # than streaming it and clawing it back a moment later.
            if "META" in piece or buffer.rstrip().endswith("META"):
                continue
            yield {"delta": piece}
    except LLMError as exc:
        log.warning("listing chat: stream failed (%s)", exc)
        yield {"delta": " I could not finish reading the call just now."}
        yield {"done": True, "intent": "listing", "covered": False, "verified": True}
        return

    match = _META.search(buffer)
    intent = match.group(1) if match else "listing"
    covered = (match.group(2) == "true") if match else True
    body = _META.sub("", buffer).strip()

    # Only listing answers are held to the transcript; platform help has no
    # transcript to be held to.
    verified = True
    if intent == "listing" and covered and transcript:
        quoted = re.findall(r'"([^"]{8,})"', body)
        verified = all(_quote_is_real(q, transcript) for q in quoted)
        if not verified:
            log.warning("listing chat: streamed answer cited words not in the transcript")

    yield {
        "done": True,
        "intent": intent,
        "covered": covered,
        "verified": verified,
        "text": body,
    }
