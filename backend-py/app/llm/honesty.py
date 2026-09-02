"""Compare the advert against the phone call, and extract the Q&A record.

Two outputs from one pass over the transcript:

* the **Q&A pairs** the customer is entitled to see — exactly what her agent
  asked and exactly what came back;
* an **honesty report** naming every place the spoken answers and the advert
  disagree.

What this does *not* do is establish that a flat exists. Nobody can, over the
phone. It scores how well the owner's own answers hold together against what was
advertised, and every finding carries their words so the customer can judge for
herself.

The same evidence guard used everywhere else applies: a quote that is not
literally in the transcript is stripped, and a finding that depended on it is
dropped. The model cannot invent a damning sentence nobody said.
"""

from __future__ import annotations

import logging
import re
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field

from app.llm.client import LLMError, complete_model, llm_available
from app.models import (
    CallLog,
    Discrepancy,
    EvasiveAnswer,
    HonestyReport,
    Listing,
    QnAPair,
    SearchCriteria,
    Speaker,
    Verdict,
)
from app.ids import new_id
from app.config import settings

log = logging.getLogger(__name__)


def _normalise(text: str) -> str:
    """Lowercase, strip punctuation, collapse whitespace.

    Loose enough that formatting differences survive, tight enough that
    different words do not: "Rent is 32,000!" matches "rent is 32 000", while
    "thirty-five thousand" does not match "thirty-two thousand".
    """
    return re.sub(r"\s+", " ", re.sub(r"[^\w\s]", " ", text.lower())).strip()


class _RawQnA(BaseModel):
    model_config = ConfigDict(extra="forbid")
    question: str
    answer: str | None = None
    quote: str | None = None


class _RawDiscrepancy(BaseModel):
    model_config = ConfigDict(extra="forbid")
    field: str
    listing_claim: str
    spoken_claim: str
    quote: str | None = None
    severity: Annotated[str, Field(pattern="^(minor|moderate|major)$")] = "moderate"


class _RawEvasion(BaseModel):
    model_config = ConfigDict(extra="forbid")
    question: str
    response: str
    quote: str | None = None
    why_evasive: str


class _RawAnalysis(BaseModel):
    model_config = ConfigDict(extra="forbid")
    qna_pairs: list[_RawQnA] = Field(default_factory=list)
    listing_discrepancies: list[_RawDiscrepancy] = Field(default_factory=list)
    evasive_answers: list[_RawEvasion] = Field(default_factory=list)
    red_flags: list[str] = Field(default_factory=list)
    positive_signals: list[str] = Field(default_factory=list)
    honesty_score: Annotated[float, Field(ge=0.0, le=10.0)]
    confidence_score: Annotated[float, Field(ge=0.0, le=1.0)]
    final_verdict: str
    summary: str


SYSTEM = """\
You are reviewing a recorded phone call between an AI assistant acting for a
prospective tenant and the person who advertised a rental property in India. You
are given what the advert claimed and the full transcript.

Produce two things: a faithful record of what was asked and answered, and an
assessment of how well the spoken answers hold together against the advert.

## The rule that governs everything

Every finding must quote the speaker's exact words, copied character for
character from the transcript. Quotes are checked programmatically; a finding
whose quote is not in the transcript is thrown away. Never paraphrase into the
quote field, and never report something you cannot quote.

## qna_pairs

One entry per question the assistant actually asked. Use the assistant's own
words for `question`. `answer` is a short, faithful summary of what came back —
null if they did not answer it. `quote` is the owner's exact sentence.

Include questions that went unanswered. A question dodged is information the
customer needs.

## listing_discrepancies

A discrepancy is a factual conflict between the advert and what was said.
Rent, maintenance, deposit, brokerage, age, furnishing, amenities, and whether
the contact is the owner or an agent.

Severity:
- minor: small or well explained — a few hundred rupees, a rounding.
- moderate: material but plausible — rent up ten percent, "the listing is stale".
- major: changes the decision — maintenance absent from the advert and thousands
  on the phone, an "owner" who says they handle it for the owner, a deposit that
  doubled.

A field the advert did not state is **not** a discrepancy. Nothing was claimed,
so nothing was contradicted. Say nothing about it.

## evasive_answers

A direct question met with a non-answer: deflection, a change of subject, "come
and see first", "we'll discuss later" about a number. Being genuinely busy is not
evasion — someone who says they are driving and offers to talk later is being
straightforward.

## red_flags and positive_signals

Short phrases. Red flags: pressure to pay a token amount immediately, refusing to
discuss price by phone, steering to a different property, claiming to be the
owner while describing a commission. Positive signals: numbers volunteered
without being pressed, costs stated up front, a specific viewing time offered, a
correction made unprompted.

## honesty_score, 1.0 to 10.0

10 — every answer consistent with the advert, costs volunteered, nothing dodged.
7-9 — broadly consistent; small differences, explained.
4-6 — material discrepancies, or several questions dodged.
1-3 — the advert materially misrepresents the property, or the person misled
      about who they are.

Score the *consistency of the answers*. You are not judging whether the flat is
nice, and you cannot tell whether it exists.

## confidence_score, 0.0 to 1.0

How much evidence you actually have. A forty-second call where three questions
were asked does not support a confident verdict however clear it seemed. Be
honest here — this is the number that stops a thin call being read as proof.

## final_verdict

One of: trustworthy, mostly_consistent, questionable, likely_misleading,
insufficient_evidence.

Use insufficient_evidence when the call was too short or too broken to judge.
That is a real answer and far more useful than a guess.

## summary

One or two sentences the customer can act on. Name the specific thing that
matters, not "some discrepancies were found".
"""


def _money(value: int | None) -> str:
    return f"Rs {value:,}" if value is not None else "not stated in the advert"


def _render(listing: Listing, call: CallLog, criteria: SearchCriteria) -> str:
    claims = [
        f"- Rent: {_money(listing.rent)}",
        f"- Maintenance: {_money(listing.maintenance)}",
        f"- Deposit: {_money(listing.deposit)}",
        f"- Brokerage: {f'{listing.brokerage_months:g} month(s)' if listing.brokerage_months is not None else 'not stated in the advert'}",
        f"- Age: {f'{listing.age_years:g} years' if listing.age_years is not None else 'not stated in the advert'}",
        f"- Type: {listing.property_type or 'not stated'}"
        + (f", {listing.bedrooms}BHK" if listing.bedrooms is not None else ""),
        f"- Furnishing: {listing.furnishing or 'not stated'}",
        f"- Amenities: {', '.join(listing.amenities) if listing.amenities else 'not stated'}",
        f"- Contact listed as: {'agent/broker' if listing.is_broker else 'owner' if listing.is_broker is False else 'not stated'}",
    ]
    transcript = "\n".join(
        f"[{turn.timestamp:>6.1f}s] {'ASSISTANT' if turn.speaker is Speaker.AGENT else 'OWNER'}: {turn.text}"
        for turn in call.transcript
    )
    wants = "\n".join(f"- {m}" for m in criteria.must_haves) or "- (none recorded)"

    return (
        f"## What the advert claimed\n\n{chr(10).join(claims)}\n\n"
        f"## What the tenant needs\n\n{wants}\n\n"
        f"## Transcript ({len(call.transcript)} turns, {call.duration_sec or '?'}s)\n\n{transcript}"
    )


def _guard(quote: str | None, haystack: str) -> str | None:
    """Keep a quote only if it is really in the transcript."""
    if not quote:
        return None
    needle = _normalise(quote)
    return quote if needle and needle in haystack else None


async def evaluate_call(
    *, listing: Listing, call: CallLog, criteria: SearchCriteria, session_id: str
) -> tuple[HonestyReport, list[QnAPair]]:
    """Analyse one completed call.

    Returns the report and the Q&A record. Never raises: a call that cannot be
    analysed still has a transcript worth showing, so the failure mode is an
    ``insufficient_evidence`` verdict rather than a lost result.
    """
    owner_text = _normalise(
        " ".join(t.text for t in call.transcript if t.speaker is Speaker.OWNER)
    )

    def _empty(reason: str, confidence: float = 0.0) -> tuple[HonestyReport, list[QnAPair]]:
        return (
            HonestyReport(
                id=new_id("rep"),
                session_id=session_id,
                listing_id=listing.id,
                call_id=call.id,
                honesty_score=5.0,
                confidence_score=confidence,
                final_verdict=Verdict.INSUFFICIENT_EVIDENCE,
                summary=reason,
                model="none",
            ),
            [],
        )

    if len(call.transcript) < 2:
        return _empty("The call ended before anything was established.")
    if not llm_available():
        return _empty("The call completed, but no analysis model is configured.")

    try:
        raw = await complete_model(
            system=SYSTEM,
            user=_render(listing, call, criteria),
            output=_RawAnalysis,
            model=settings.reasoning_model,
            temperature=0.0,
        )
    except LLMError as exc:
        log.warning("honesty: %s could not be analysed (%s)", call.id, exc)
        return _empty("The call completed, but the analysis could not be run.")

    # --- the evidence guard ------------------------------------------------
    dropped = 0

    qna: list[QnAPair] = []
    for item in raw.qna_pairs:
        quote = _guard(item.quote, owner_text)
        if item.quote and not quote:
            dropped += 1
        qna.append(QnAPair(question=item.question, answer=item.answer, quote=quote))

    discrepancies: list[Discrepancy] = []
    for item in raw.listing_discrepancies:
        quote = _guard(item.quote, owner_text)
        if item.quote and not quote:
            # A discrepancy is an accusation. Without the words that support it,
            # it does not get made.
            dropped += 1
            continue
        discrepancies.append(
            Discrepancy(
                field=item.field,
                listing_claim=item.listing_claim,
                spoken_claim=item.spoken_claim,
                quote=quote,
                severity=item.severity,
            )
        )

    evasions: list[EvasiveAnswer] = []
    for item in raw.evasive_answers:
        quote = _guard(item.quote, owner_text)
        if item.quote and not quote:
            dropped += 1
            continue
        evasions.append(
            EvasiveAnswer(
                question=item.question,
                response=item.response,
                quote=quote,
                why_evasive=item.why_evasive,
            )
        )

    if dropped:
        log.warning("honesty: %s — dropped %d unquotable finding(s)", call.id, dropped)

    try:
        verdict = Verdict(raw.final_verdict)
    except ValueError:
        verdict = Verdict.INSUFFICIENT_EVIDENCE

    report = HonestyReport(
        id=new_id("rep"),
        session_id=session_id,
        listing_id=listing.id,
        call_id=call.id,
        honesty_score=raw.honesty_score,
        confidence_score=raw.confidence_score,
        listing_discrepancies=discrepancies,
        evasive_answers=evasions,
        red_flags=raw.red_flags,
        positive_signals=raw.positive_signals,
        final_verdict=verdict,
        summary=raw.summary,
        model=settings.reasoning_model,
    )

    log.info(
        "honesty: %s scored %.1f/10 (%s), %d discrepancy(ies)",
        call.id,
        report.honesty_score,
        verdict.value,
        len(discrepancies),
    )
    return report, qna
