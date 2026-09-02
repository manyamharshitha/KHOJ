"""A dialer that completes calls from a fixture, instantly and for free.

Not a testing nicety. It is what lets the whole pipeline — ranking, quota,
transcript storage, honesty evaluation, the verifications subcollection, the
API — be exercised without a CALL-E account or a rupee of call spend. It returns
the same ``CallOutcome`` shape as the real dialer, so on demo day the only
untested code is the SDK call itself.
"""

from __future__ import annotations

import logging

from app.models import CallStatus, Listing, QnAPair, SearchCriteria, Speaker, TranscriptTurn
from app.telephony.calle_dialer import CallOutcome, _build_qna

log = logging.getLogger(__name__)


class MockDialer:
    """Simulates a CALL-E verification call."""

    name = "mock"

    async def verify(
        self,
        *,
        call_id: str,
        listing: Listing,
        criteria: SearchCriteria,
        task: str,
        attempt: int = 1,
    ) -> CallOutcome:
        """Return a plausible conversation for this listing.

        The rent quoted on the phone is deliberately higher than the advert and
        a maintenance charge appears that the advert never mentioned — the two
        most common real discrepancies, so the honesty evaluator has something
        true to find rather than a clean call that proves nothing.
        """
        advertised = listing.rent or 28_000
        quoted_rent = advertised + 4_000
        quoted_maintenance = 4_500

        turns = [
            TranscriptTurn(
                speaker=Speaker.AGENT,
                text=(
                    "Hello — I'm an AI assistant calling on behalf of someone looking for "
                    "a flat. This will take under a minute, and I'm recording it so she can "
                    "hear your answers herself. Is that alright?"
                ),
                timestamp=0.0,
            ),
            TranscriptTurn(speaker=Speaker.OWNER, text="Haan haan, fine, tell me.", timestamp=8.4),
            TranscriptTurn(
                speaker=Speaker.AGENT, text="When could she come and see the flat?", timestamp=10.1
            ),
            TranscriptTurn(
                speaker=Speaker.OWNER,
                text="Anytime, this evening also. The current tenant moved out last week.",
                timestamp=12.6,
            ),
            TranscriptTurn(
                speaker=Speaker.AGENT,
                text="And what's the rent and maintenance right now?",
                timestamp=18.2,
            ),
            TranscriptTurn(
                speaker=Speaker.OWNER,
                text=(
                    f"Rent is {quoted_rent:,}, maintenance {quoted_maintenance:,} separate. "
                    "The listing is showing the old price."
                ),
                timestamp=20.9,
            ),
            TranscriptTurn(
                speaker=Speaker.AGENT,
                text=f"So {quoted_rent:,} rent and {quoted_maintenance:,} maintenance — correct?",
                timestamp=28.0,
            ),
            TranscriptTurn(speaker=Speaker.OWNER, text="Correct.", timestamp=31.5),
            TranscriptTurn(
                speaker=Speaker.AGENT, text="Is there a brokerage on top?", timestamp=33.0
            ),
            TranscriptTurn(
                speaker=Speaker.OWNER,
                text="One month, standard. I handle it for the owner.",
                timestamp=35.2,
            ),
            TranscriptTurn(
                speaker=Speaker.AGENT, text="What is the water supply like?", timestamp=38.4
            ),
            TranscriptTurn(
                speaker=Speaker.OWNER,
                text="Borewell plus corporation, twenty-four hours, no problem.",
                timestamp=40.1,
            ),
            TranscriptTurn(
                speaker=Speaker.AGENT,
                text="That's everything, thank you. She'll call you back directly if it's a fit.",
                timestamp=45.0,
            ),
        ]

        structured = {
            "available": "yes",
            "bait_pivot": "no",
            "rent_actual": str(quoted_rent),
            "maintenance_actual": str(quoted_maintenance),
            "deposit_actual": "3 months",
            "brokerage": "1",
            "water_supply": "Borewell plus corporation, twenty-four hours",
            "restrictions": "",
            # The advert said owner; on the phone they describe a commission.
            # That contradiction is the point of the fixture.
            "is_broker": "yes",
            "consent_to_record": "yes",
            "notes": "Listing price is stale; maintenance is charged separately.",
        }
        for index, question in enumerate(criteria.custom_questions[:8]):
            structured[f"custom_{index}"] = ""

        log.info("[%s] mock verification for %s", call_id, listing.contact_number)

        return CallOutcome(
            provider_call_id=f"mock_{call_id}_{attempt}",
            status=CallStatus.COMPLETED,
            transcript=turns,
            structured=structured,
            qna=_build_qna(structured, criteria, turns),
            duration_sec=int(turns[-1].timestamp) + 2,
            recording_url=None,
            consent_to_record=True,
            summary="Available, but quoted above the advert with maintenance on top.",
        )

    def close(self) -> None:
        return None
