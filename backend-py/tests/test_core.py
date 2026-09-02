"""Tests for the parts that decide whether the product can be trusted.

Deliberately no network, no Firebase, no LLM. Everything here is the pure logic
that governs what gets dialled, in what order, and what a customer is told —
which is exactly the code that must not break quietly.
"""

from __future__ import annotations

import pytest

from app.config import Settings
from app.llm.extractor import extract_phone_candidates, to_e164
from app.llm.honesty import _guard, _normalise
from app.models import Listing, SearchCriteria
from app.ranking import call_order, filter_hard_constraints, rank_listings
from app.telephony import persona


def listing(
    lid: str,
    rent: int | None = None,
    maintenance: int | None = None,
    age: float | None = None,
    phone: str | None = None,
    deposit: int | None = None,
    bedrooms: int | None = None,
) -> Listing:
    return Listing(
        id=lid,
        session_id="s",
        source_site="test",
        rent=rent,
        maintenance=maintenance,
        age_years=age,
        contact_number=phone,
        deposit=deposit,
        bedrooms=bedrooms,
    )


# ------------------------------------------------------------------ phones


class TestPhoneNumbers:
    """A wrong rent is a blank cell. A wrong phone number is a call to a stranger."""

    @pytest.mark.parametrize(
        ("raw", "expected"),
        [
            ("9876543210", "+919876543210"),
            ("09876543210", "+919876543210"),
            ("+91 98765 43210", "+919876543210"),
            ("98765-43210", "+919876543210"),
            ("919876543210", "+919876543210"),
        ],
    )
    def test_accepts_the_shapes_people_paste(self, raw: str, expected: str) -> None:
        assert to_e164(raw) == expected

    @pytest.mark.parametrize(
        "raw",
        [
            "12345",
            "5876543210",  # Indian mobiles start 6-9; this is a typo
            "040-23456789",  # landline
            "not a number",
            "",
        ],
    )
    def test_rejects_what_cannot_be_dialled(self, raw: str) -> None:
        assert to_e164(raw) is None

    def test_finds_numbers_in_a_messy_page(self) -> None:
        page = (
            "2BHK Kondapur, 28,000 rent + 2,000 maintenance. Ramesh 9876543210\n"
            "Gachibowli 3BHK - 30000 - +91 98765 43211\n"
            "Office landline 040-23456789 - do not call\n"
            "Deposit 150000, available 2026-09-14"
        )
        assert extract_phone_candidates(page) == ["+919876543210", "+919876543211"]

    def test_does_not_mistake_money_or_dates_for_phones(self) -> None:
        text = "Rent 28,000 maintenance 2000 deposit 150000, available 2026-09-14"
        assert extract_phone_candidates(text) == []

    def test_deduplicates_the_same_number_written_twice(self) -> None:
        assert extract_phone_candidates("call 9876543210 or +91 98765 43210") == [
            "+919876543210"
        ]


# ----------------------------------------------------------------- ranking


class TestRanking:
    def test_total_is_rent_plus_maintenance(self) -> None:
        assert listing("a", 30_000, 2_000).total_monthly_cost == 32_000

    def test_missing_maintenance_counts_as_zero(self) -> None:
        assert listing("a", 30_000).total_monthly_cost == 30_000

    def test_unknown_rent_has_no_total(self) -> None:
        assert listing("a", None, 2_000).total_monthly_cost is None

    def test_cheapest_first(self) -> None:
        rows = [listing("dear", 40_000), listing("cheap", 25_000), listing("mid", 30_000)]
        assert [x.id for x in rank_listings(rows)] == ["cheap", "mid", "dear"]

    def test_newer_building_breaks_a_price_tie(self) -> None:
        rows = [listing("old", 25_000, 0, age=30), listing("new", 25_000, 0, age=2)]
        assert [x.id for x in rank_listings(rows)] == ["new", "old"]

    def test_ranks_on_total_not_rent(self) -> None:
        """The whole point: portals advertise rent and hide maintenance."""
        rows = [
            listing("low_rent_high_maint", 28_000, 8_000),  # 36,000 all-in
            listing("high_rent_no_maint", 31_000, 0),  # 31,000 all-in
        ]
        assert [x.id for x in rank_listings(rows)] == [
            "high_rent_no_maint",
            "low_rent_high_maint",
        ]

    def test_unknown_cost_sorts_last_not_first(self) -> None:
        """A hidden price must never be treated as free."""
        rows = [listing("unknown"), listing("cheap", 25_000)]
        assert [x.id for x in rank_listings(rows)] == ["cheap", "unknown"]

    def test_only_listings_with_a_number_are_called(self) -> None:
        rows = [listing("callable", 30_000, phone="+919876543210"), listing("no_phone", 20_000)]
        assert [x.id for x in call_order(rows, 10)] == ["callable"]


class TestHardConstraints:
    def test_drops_a_listing_over_the_stated_budget(self) -> None:
        criteria = SearchCriteria(max_total_monthly=35_000)
        kept, dropped = filter_hard_constraints(
            [listing("ok", 30_000, 2_000), listing("over", 40_000, 0)], criteria
        )
        assert [x.id for x in kept] == ["ok"]
        assert dropped[0][0].id == "over"
        assert "ceiling" in dropped[0][1]

    def test_keeps_a_listing_whose_field_is_unknown(self) -> None:
        """The unknown is what the phone call is for.

        Excluding it here would hide a possibly-perfect home because a portal
        was vague, and the customer would never know.
        """
        criteria = SearchCriteria(bedrooms=2)
        kept, _ = filter_hard_constraints([listing("unknown_beds", 20_000)], criteria)
        assert [x.id for x in kept] == ["unknown_beds"]

    def test_applies_nothing_the_customer_did_not_state(self) -> None:
        kept, dropped = filter_hard_constraints(
            [listing("a", 90_000, 9_000, age=40)], SearchCriteria()
        )
        assert len(kept) == 1 and not dropped


# -------------------------------------------------------------- compliance


class TestCallCompliance:
    def test_shipped_script_passes(self) -> None:
        persona.assert_compliance()

    @pytest.mark.parametrize(
        ("opener", "reason"),
        [
            ("Hello, calling about your flat. Recording this.", "AI disclosure removed"),
            ("Hello, I am an AI assistant calling for a tenant.", "consent request removed"),
        ],
    )
    def test_refuses_to_start_without_the_obligations(self, opener: str, reason: str) -> None:
        original = persona.OPENER
        persona.OPENER = opener
        try:
            with pytest.raises(RuntimeError):
                persona.assert_compliance()
        finally:
            persona.OPENER = original

    def test_instructions_carry_the_listing_and_the_must_haves(self) -> None:
        prompt = persona.build_instructions(
            listing("l1", 28_000, 2_000, age=3),
            SearchCriteria(must_haves=["reserved parking"], custom_questions=["Power backup?"]),
            "2BHK under Rs 35,000",
        )
        assert "Rs 28,000" in prompt
        assert "Rs 2,000" in prompt
        assert "reserved parking" in prompt
        assert "Power backup?" in prompt
        assert "never negotiate" in prompt.lower()


# ------------------------------------------------------------ evidence guard


class TestEvidenceGuard:
    """The evaluator may not invent a sentence nobody said."""

    OWNER = _normalise(
        "Rent is thirty-two thousand, maintenance four thousand five hundred separate. "
        "I handle it for the owner."
    )

    def test_keeps_a_real_quote(self) -> None:
        assert _guard("Rent is thirty-two thousand", self.OWNER) is not None

    def test_ignores_punctuation_and_case(self) -> None:
        assert _guard("rent is thirty two thousand", self.OWNER) is not None

    def test_discards_an_invented_figure(self) -> None:
        assert _guard("Rent is fifty thousand", self.OWNER) is None

    def test_discards_an_invented_sentence(self) -> None:
        assert _guard("He refused to give a price", self.OWNER) is None

    def test_discards_an_empty_quote(self) -> None:
        assert _guard("", self.OWNER) is None


# -------------------------------------------------------------- call windows


class TestCallWindows:
    def test_parses_the_configured_hours(self) -> None:
        assert Settings(call_windows_ist="11:00-13:00,17:00-20:00").windows_ist == [
            (660, 780),
            (1020, 1200),
        ]

    @pytest.mark.parametrize("bad", ["garbage", "20:00-17:00", "25:00-26:00", "11-13"])
    def test_a_malformed_value_falls_back_rather_than_permitting_every_hour(
        self, bad: str
    ) -> None:
        """An empty window list would mean 3am is fine. It is not."""
        assert Settings(call_windows_ist=bad).windows_ist == [(660, 780), (1020, 1200)]

    def test_localhost_is_refused_for_telephony(self) -> None:
        with pytest.raises(RuntimeError, match="https"):
            Settings(public_url="http://localhost:8000").require_public_https()
