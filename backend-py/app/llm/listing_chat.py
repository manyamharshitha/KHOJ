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
from typing import Any

from pydantic import Field

from app.llm.client import LLMError, complete_model, llm_available
from app.models import Base, CallLog, HonestyReport, Listing

log = logging.getLogger(__name__)

#: What the customer sees when the call genuinely did not establish something.
NOT_COVERED = "The call didn't cover that."

#: The transcript is the whole context, and a long one costs tokens on every
#: question. Calls run to roughly sixty turns, so this keeps entire calls intact
#: while capping a pathological one.
MAX_TURNS = 120


class ListingAnswer(Base):
    """One grounded answer about one listing."""

    answer: str = Field(max_length=800)
    #: Whether the call actually established this. False means say so plainly.
    covered: bool
    #: The broker's own words supporting the answer. Verified against the
    #: transcript before the answer is shown.
    quote: str | None = Field(default=None, max_length=400)


SYSTEM = """\
You answer a tenant's questions about one rental property, using only what was
said on a recorded phone call with the person who advertised it.

You have the advert, the call transcript, and an honesty analysis of that call.

Rules, in order of importance:

1. Answer ONLY from the transcript and the advert given to you. Never use general
   knowledge about rents, localities, or Indian property markets. If the call did
   not establish it, you do not know it.
2. If the transcript does not answer the question, set covered=false and put
   exactly this in answer: "The call didn't cover that."
3. When the answer IS in the transcript, set covered=true and put the broker's
   supporting words in quote, copied character for character from the transcript.
   Do not paraphrase inside quote.
4. Where the call contradicts the advert, say both and say which came from the
   call. The spoken figure is the current one; the advert may be stale.
5. Be brief. Two sentences at most. The tenant is scanning several of these.
6. Never advise, never speculate about whether it is a good deal, never invent a
   viewing time or a phone number.
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
    if result.covered and not _quote_is_real(result.quote, transcript):
        log.warning(
            "listing chat: discarded an answer whose quote is not in the transcript: %r",
            (result.quote or "")[:120],
        )
        return ListingAnswer(answer=NOT_COVERED, covered=False)

    # A model that says "not covered" while filling in a confident answer is
    # contradicting itself; the honest half wins.
    if not result.covered:
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
