"""Drafting deposit-negotiation messages.

Three drafts, not one, because the point is to give the customer something to
choose between and edit — a single suggestion invites being sent unread, and
these messages go to a real person who is being asked for money.

Two rules the prompt enforces and this module checks afterwards, because a model
asked politely will still occasionally do both:

* **No invented facts.** No market averages, no "similar flats nearby go for X",
  no legal citations. Khoj does not have that data, and a negotiating position
  built on a number nobody verified collapses the moment the broker asks where
  it came from — taking the renter's credibility with it.
* **No pressure.** No deadlines, no threats to walk, no implied competing offer
  unless the customer said so themselves.
"""

from __future__ import annotations

import logging
import re

from pydantic import BaseModel, Field

from app.llm.client import LLMError, complete_model, llm_available

log = logging.getLogger(__name__)

SYSTEM = """You draft short WhatsApp/SMS messages for a tenant in India asking a \
broker or owner to reduce a security deposit.

Write exactly 3 alternatives, in this order:
1. Polite and brief - simply asks.
2. Reasoned - leads with the tenant's own stated circumstances.
3. Trade - offers something concrete in return (longer lock-in, earlier move-in,
   faster payment), drawn only from what the tenant actually said.

Hard rules:
- Use ONLY facts the tenant gave you. You have no market data, no comparable
  rents, and no legal information. Never state what other properties charge,
  never cite a law or an act, never claim a norm or an average.
- No deadlines, no ultimatums, no threats to walk away, no invented competing
  offers.
- Indian English, plain and warm. 40 words or fewer each. No emoji.
- Refer to money as the tenant did. Do not round or restate amounts differently.
- Do not open with "Dear Sir/Madam" or sign off with a name.

Return JSON: {"drafts": [{"tone": "polite|reasoned|trade", "message": "..."}]}"""

#: Claims a draft must not contain. Each is a thing the model has no source for,
#: and which reads as authoritative to whoever receives the message.
_UNSOURCED = re.compile(
    r"\b("
    r"market (rate|average|standard|norm)"
    r"|average deposit"
    r"|similar (flats?|properties|places)"
    r"|other (flats?|properties|landlords|brokers)\s+(charge|are|offer)"
    r"|(as per|under|according to) (the )?(law|act|rules?|rent control)"
    r"|legally|statutory|regulation"
    r"|industry standard|going rate|comparable"
    r")\b",
    re.I,
)

#: Pressure tactics. A tenant may choose to apply pressure; the model may not do
#: it on their behalf without being asked.
_PRESSURE = re.compile(
    r"\b("
    r"(by|before) (today|tomorrow|tonight|end of day|eod)"
    r"|final offer|last chance|take it or leave"
    r"|another (tenant|party|offer)|someone else is"
    r"|i will (walk|leave|look elsewhere)"
    r"|or else|otherwise i"
    r")\b",
    re.I,
)


class Draft(BaseModel):
    tone: str = Field(default="polite", max_length=20)
    message: str = Field(default="", max_length=600)


class DraftSet(BaseModel):
    drafts: list[Draft] = Field(default_factory=list)


def _rupees(value: int | None) -> str:
    return f"Rs {value:,}" if isinstance(value, int) else "an unstated amount"


def screen(message: str) -> str | None:
    """Why this draft must not be shown, or ``None`` if it is fine."""
    if not message.strip():
        return "empty"
    if _UNSOURCED.search(message):
        return "cites data Khoj does not have"
    if _PRESSURE.search(message):
        return "applies pressure the customer did not ask for"
    return None


async def draft_offers(
    *,
    current_deposit: int | None,
    desired_deposit: int | None,
    reason: str,
    property_title: str | None = None,
    rent: int | None = None,
) -> list[Draft]:
    """Three messages the customer can pick from and edit.

    Returns an empty list when no model is configured or the call fails.
    Deliberately not a fallback template: a canned message presented as though a
    model wrote it for this situation is worse than an honest empty state, and
    the customer can always write their own.
    """
    if not llm_available():
        log.info("negotiation: no LLM configured, no drafts generated")
        return []

    user = (
        f"Property: {property_title or 'a rental property'}\n"
        f"Monthly rent: {_rupees(rent)}\n"
        f"Deposit being asked: {_rupees(current_deposit)}\n"
        f"Deposit the tenant wants: {_rupees(desired_deposit)}\n"
        f"In the tenant's own words: {reason.strip() or '(they did not give a reason)'}"
    )

    try:
        result = await complete_model(
            system=SYSTEM, user=user, output=DraftSet, temperature=0.7
        )
    except LLMError as exc:
        log.warning("negotiation: drafting failed (%s)", exc)
        return []

    kept: list[Draft] = []
    for draft in result.drafts[:3]:
        problem = screen(draft.message)
        if problem:
            # Dropped rather than repaired. A message that had to be edited to
            # remove an invented market rate is not a message this system should
            # be putting in front of someone to send.
            log.warning("negotiation: dropped a draft - %s", problem)
            continue
        kept.append(draft)

    log.info("negotiation: %d of %d draft(s) passed screening", len(kept), len(result.drafts))
    return kept
