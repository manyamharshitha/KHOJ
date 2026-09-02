"""Turn a customer's sentence into structured search criteria.

No keyword rules, no regex for "2BHK", no city lookup table. The customer writes
how she talks and the model reads it — which is the only approach that survives
"somewhere I can walk to the metro from, and my mother visits so a spare room
would help".
"""

from __future__ import annotations

import logging

from app.llm.client import LLMError, complete_model, llm_available
from app.models import SearchCriteria

log = logging.getLogger(__name__)

SYSTEM = """\
You read one sentence from someone looking for a home to rent in India, and turn
it into search criteria.

The rule that matters more than any other: record only what she actually said.

Do not infer a city from a locality you happen to recognise. Do not turn "cheap"
into a number. Do not assume a couple wants two bedrooms. Do not fill
`tenant_profile` because the phrasing hints at it. Every field you are unsure
about stays null, and null is a completely acceptable answer for all of them.

A field left null simply is not used as a filter, so she sees more results and
decides for herself. A field you guessed wrong silently removes homes she would
have wanted, and she never finds out.

Notes on specific fields:

- max_total_monthly is rent plus maintenance combined, in rupees. "35k" is 35000,
  "under 1.2 lakh" is 120000. If she gave a range, record the top of it.
- bedrooms: "2BHK" is 2, "studio" is 0, "1RK" is 0. Leave null if she only said
  "small" or "big".
- localities: neighbourhood names exactly as she wrote them. Do not expand
  abbreviations you are not certain of.
- max_property_age_years: "new building" is roughly 5, "not too old" is null —
  the first is a real constraint, the second is a preference with no number in it.
- must_haves: her requirements that do not fit any structured field, copied close
  to her own words: "good water supply", "reserved parking", "pet friendly" if
  there is no boolean for it, "south facing", "near a metro station".
- nice_to_haves: things she framed as a bonus rather than a requirement.
- custom_questions: anything she explicitly wants asked when someone phones the
  owner. Only include a question if she asked for it; do not invent a checklist.

Prefer must_haves over inventing a structured field. A requirement recorded as
free text still reaches the ranking and still gets asked about on the phone.
"""


async def parse_preferences(prompt: str) -> SearchCriteria:
    """Extract structured criteria from free text.

    Returns empty criteria — not an error — when no LLM is configured or the
    model fails. An unfiltered search that returns everything is a degraded
    result the customer can still use; a crashed search is not.
    """
    if not llm_available():
        log.warning("preferences: no LLM configured, searching without filters")
        return SearchCriteria(must_haves=[prompt.strip()[:200]])

    try:
        criteria = await complete_model(
            system=SYSTEM,
            user=prompt,
            output=SearchCriteria,
            temperature=0.0,
        )
    except LLMError as exc:
        log.warning("preferences: parse failed (%s), searching without filters", exc)
        return SearchCriteria(must_haves=[prompt.strip()[:200]])

    log.info(
        "preferences: city=%s localities=%s beds=%s budget=%s must_haves=%d",
        criteria.city,
        criteria.localities,
        criteria.bedrooms,
        criteria.max_total_monthly,
        len(criteria.must_haves),
    )
    return criteria


def criteria_summary(criteria: SearchCriteria) -> str:
    """One-line human summary, for logs, the call script and the UI."""
    bits: list[str] = []
    if criteria.bedrooms is not None:
        bits.append(f"{criteria.bedrooms}BHK")
    if criteria.property_type and criteria.bedrooms is None:
        bits.append(criteria.property_type)
    if criteria.localities:
        bits.append("in " + " / ".join(criteria.localities))
    elif criteria.city:
        bits.append(f"in {criteria.city}")
    if criteria.max_total_monthly:
        bits.append(f"under Rs {criteria.max_total_monthly:,}/month all-in")
    if criteria.max_property_age_years is not None:
        bits.append(f"under {criteria.max_property_age_years:g} years old")
    if criteria.pets_allowed:
        bits.append("pet friendly")
    if criteria.must_haves:
        bits.append("must have: " + ", ".join(criteria.must_haves))
    return "; ".join(bits) or "no specific constraints given"
