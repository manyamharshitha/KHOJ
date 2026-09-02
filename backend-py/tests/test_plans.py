"""Tests for plan quotas and the CALL-E result mapping.

Every verified listing costs a real phone call, so the quota is the thing
standing between a free account and an unbounded telephony bill. It is tested
accordingly.
"""

from __future__ import annotations

import pytest

from app.core.plans import (
    CUSTOM_AGENCY_THRESHOLD,
    PLAN_LIMITS,
    Quota,
    Tier,
    clip_to_plan,
    limit_for,
    next_tier,
    normalise_tier,
    plan_catalogue,
)
from app.models import AgencyLeadRequest, Listing, SearchCriteria
from app.ranking import rank_listings
from app.telephony.calle_dialer import _build_qna, _map_status, _map_turns, _tri, spoken_int


def listing(lid: str, rent: int | None = None, maintenance: int | None = None) -> Listing:
    return Listing(
        id=lid, session_id="s", source_site="t", rent=rent, maintenance=maintenance
    )


class TestPlanLimits:
    def test_the_four_tiers_are_what_the_ui_promises(self) -> None:
        assert PLAN_LIMITS == {"free": 2, "silver": 6, "gold": 15, "premium": 25}

    def test_custom_agency_starts_above_premium(self) -> None:
        assert CUSTOM_AGENCY_THRESHOLD == PLAN_LIMITS["premium"] == 25

    @pytest.mark.parametrize(
        ("stored", "expected"),
        [("free", Tier.FREE), ("GOLD", Tier.GOLD), ("  silver ", Tier.SILVER)],
    )
    def test_reads_a_stored_tier(self, stored: str, expected: Tier) -> None:
        assert normalise_tier(stored) is expected

    @pytest.mark.parametrize("bad", [None, "", "platinum", "enterprise"])
    def test_an_unrecognised_tier_falls_back_to_free(self, bad: str | None) -> None:
        """A corrupt field should cost someone their upgrade, not lock them out."""
        assert normalise_tier(bad) is Tier.FREE

    def test_premium_is_the_top(self) -> None:
        assert next_tier(Tier.PREMIUM) is Tier.PREMIUM
        assert next_tier(Tier.FREE) is Tier.SILVER

    def test_catalogue_covers_every_tier(self) -> None:
        assert {p["tier"] for p in plan_catalogue()} == set(PLAN_LIMITS)


class TestQuota:
    def test_counts_what_is_left(self) -> None:
        assert Quota(tier=Tier.SILVER, limit=6, used=2).remaining == 4

    def test_a_downgrade_cannot_produce_negative_remaining(self) -> None:
        """Used can exceed limit after a tier drop; the answer is zero, not -9."""
        quota = Quota(tier=Tier.FREE, limit=2, used=11)
        assert quota.remaining == 0
        assert quota.exhausted

    def test_exhausted_message_names_the_next_step(self) -> None:
        assert "silver" in Quota(tier=Tier.FREE, limit=2, used=2).message().lower()

    def test_premium_is_pointed_at_the_agency_flow_not_an_upgrade(self) -> None:
        message = Quota(tier=Tier.PREMIUM, limit=25, used=25).message()
        assert "custom agency" in message.lower()
        assert "25" in message


class TestClipping:
    def test_clips_to_the_tier(self) -> None:
        rows = [listing(str(i), 10_000 + i) for i in range(10)]
        kept, dropped = clip_to_plan(rows, Tier.FREE)
        assert len(kept) == 2
        assert dropped == 8

    def test_already_consumed_quota_reduces_the_allowance(self) -> None:
        rows = [listing(str(i), 10_000 + i) for i in range(10)]
        kept, dropped = clip_to_plan(rows, Tier.SILVER, used=4)
        assert len(kept) == 2  # 6 limit - 4 used
        assert dropped == 8

    def test_nothing_is_clipped_when_it_fits(self) -> None:
        rows = [listing("a", 10_000)]
        assert clip_to_plan(rows, Tier.GOLD) == (rows, 0)

    def test_clipping_keeps_the_cheapest(self) -> None:
        """Clipping must run after ranking.

        Applied to an unsorted list it would throw away the cheapest properties
        — the exact opposite of what the customer is paying for.
        """
        rows = [listing("dear", 90_000), listing("cheap", 10_000), listing("mid", 40_000)]
        kept, _ = clip_to_plan(rank_listings(rows), Tier.FREE)
        assert [x.id for x in kept] == ["cheap", "mid"]

    def test_an_exhausted_plan_keeps_nothing(self) -> None:
        rows = [listing(str(i), 10_000) for i in range(5)]
        kept, dropped = clip_to_plan(rows, Tier.FREE, used=2)
        assert kept == [] and dropped == 5


class TestAgencyLeadValidation:
    @pytest.mark.parametrize("email", ["ops@acme.co", "a.b+tag@sub.domain.in"])
    def test_accepts_real_addresses(self, email: str) -> None:
        assert AgencyLeadRequest(email=email).email == email

    @pytest.mark.parametrize("email", ["nope", "@x.com", "a@b", "a@", ""])
    def test_rejects_what_could_never_receive_mail(self, email: str) -> None:
        with pytest.raises(ValueError):
            AgencyLeadRequest(email=email)


class TestCalleMapping:
    """CALL-E's shape into ours. Unknown must never become a decision."""

    @pytest.mark.parametrize(
        ("raw", "expected"), [("yes", True), ("no", False), ("unknown", None), ("", None), (None, None)]
    )
    def test_three_states_not_two(self, raw: str | None, expected: bool | None) -> None:
        assert _tri(raw) is expected

    @pytest.mark.parametrize(
        ("raw", "expected"),
        [
            ("32000", 32_000),
            ("Rs 32,000", 32_000),
            ("32k", 32_000),
            ("1.2 lakh", 120_000),
            ("", None),
            ("unknown", None),
            ("no idea", None),
        ],
    )
    def test_reads_a_spoken_rupee_figure(self, raw: str, expected: int | None) -> None:
        assert spoken_int(raw) == expected

    def test_bot_is_the_agent_and_user_is_the_person_we_rang(self) -> None:
        turns = _map_turns(
            [
                {"speaker": "bot", "text": "Hello", "offset_seconds": 0},
                {"speaker": "user", "text": "Haan", "offset_seconds": 4},
            ]
        )
        assert [t.speaker.value for t in turns] == ["agent", "owner"]
        assert turns[1].timestamp == 4.0

    def test_drops_empty_turns(self) -> None:
        assert _map_turns([{"speaker": "user", "text": "   ", "offset_seconds": 1}]) == []

    def test_a_completed_task_with_no_transcript_is_a_no_answer(self) -> None:
        status = _map_status({"status": "completed"}, {"transcript_turns": []})
        assert status.value == "no_answer"

    def test_reads_a_failure_code(self) -> None:
        assert (
            _map_status({"status": "failed"}, {"failure_code": "no_answer"}).value == "no_answer"
        )
        assert _map_status({"status": "failed"}, {"failure_code": "busy"}).value == "busy"

    def test_unanswered_questions_still_appear_in_the_record(self) -> None:
        """A question that was dodged is information the customer needs.

        Omitting it would make the transparency record look complete when it is
        not.
        """
        pairs = _build_qna({"available": "yes", "rent_actual": ""}, SearchCriteria(), [])
        by_question = {p.question: p for p in pairs}
        assert any(p.answer is None for p in pairs)
        assert len(pairs) >= 8
        assert by_question["What is the rent right now?"].answer is None

    def test_the_customers_own_questions_are_included(self) -> None:
        criteria = SearchCriteria(custom_questions=["Is there a power backup?"])
        pairs = _build_qna({"custom_0": "Yes, full backup"}, criteria, [])
        assert any(p.question == "Is there a power backup?" for p in pairs)
        assert any(p.answer == "Yes, full backup" for p in pairs)
