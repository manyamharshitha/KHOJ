"""Repository tests against an in-memory MongoDB.

These replace the Firestore emulator suite. Firestore Enterprise speaks the
MongoDB wire protocol and the Firebase CLI emulator does not implement it, so
there is no local server to point at — ``mongomock_motor`` stands in.

What is being proved here is the part that is easy to get wrong and expensive to
get wrong in production: that the quota cannot be over-spent by two searches
running at once, that ranking really is cheapest-first, and that a lead is
durable before anyone tries to notify anybody about it.
"""

from __future__ import annotations

import asyncio

import pytest

from app import repositories as repo
from app.core.plans import PLAN_LIMITS, Tier, limit_for, normalise_tier
from app.models import (
    AgencyLead,
    CallStatus,
    Listing,
    SearchCriteria,
    SearchSession,
    TargetSite,
    UserProfile,
    Verification,
)

pytestmark = pytest.mark.usefixtures("mongo_db")


# --------------------------------------------------------------------------
# factories
# --------------------------------------------------------------------------


def a_user(uid: str = "usr_1", tier: Tier = Tier.FREE, used: int = 0) -> UserProfile:
    return UserProfile(
        uid=uid,
        email=f"{uid}@example.com",
        name="Test User",
        tier=tier.value,
        listings_limit=limit_for(tier),
        listings_used=used,
    )


def a_listing(
    listing_id: str,
    session_id: str = "ses_1",
    rent: int | None = None,
    maintenance: int | None = None,
    age_years: float | None = None,
) -> Listing:
    return Listing(
        id=listing_id,
        session_id=session_id,
        source_site="nobroker",
        title=f"Flat {listing_id}",
        rent=rent,
        maintenance=maintenance,
        age_years=age_years,
        contact_number="+919000000001",
    )


def a_session(session_id: str = "ses_1", customer_id: str = "usr_1") -> SearchSession:
    return SearchSession(
        id=session_id,
        customer_id=customer_id,
        prompt="2BHK in Kondapur under 25000",
        criteria=SearchCriteria(),
        target_sites=[TargetSite(name="nobroker", url="https://www.nobroker.in/")],
    )


def a_verification(listing_id: str = "lst_1") -> Verification:
    return Verification(
        listing_id=listing_id,
        call_id="cal_1",
        phone_dialed="+919000000001",
        call_status=CallStatus.COMPLETED.value,
    )


# --------------------------------------------------------------------------
# 1-4  users, tiers and the pricing table
# --------------------------------------------------------------------------


async def test_creating_a_user_starts_on_free_with_two_verifications() -> None:
    await repo.create_user_if_absent(a_user("usr_new"))

    doc = await repo.get_user("usr_new")
    assert doc is not None
    assert doc["_id"] == "usr_new"
    assert doc["tier"] == Tier.FREE.value
    assert doc["listings_limit"] == 2
    assert doc["listings_used"] == 0


async def test_plan_limits_match_the_pricing_table() -> None:
    """The numbers the pricing page promises, enforced from one place."""
    assert PLAN_LIMITS[Tier.FREE] == 2
    assert PLAN_LIMITS[Tier.SILVER] == 6
    assert PLAN_LIMITS[Tier.GOLD] == 15
    assert PLAN_LIMITS[Tier.PREMIUM] == 25

    for tier, expected in ((Tier.FREE, 2), (Tier.SILVER, 6), (Tier.GOLD, 15), (Tier.PREMIUM, 25)):
        await repo.create_user_if_absent(a_user(f"usr_{tier.value}", tier=tier))
        stored_tier, _ = await repo.read_quota_doc(f"usr_{tier.value}")
        assert limit_for(normalise_tier(stored_tier)) == expected


async def test_upgrading_a_tier_raises_the_limit_and_keeps_usage() -> None:
    await repo.create_user_if_absent(a_user("usr_up", tier=Tier.FREE))
    assert await repo.consume_quota_atomic("usr_up", plan_limit=2, count=2)

    updated = await repo.set_user_tier("usr_up", Tier.GOLD.value, limit_for(Tier.GOLD))

    assert updated is not None
    assert updated["tier"] == Tier.GOLD.value
    assert updated["listings_limit"] == 15
    # An upgrade buys headroom; it does not refund what was already spent.
    assert updated["listings_used"] == 2


async def test_an_unrecognised_stored_tier_falls_back_to_free() -> None:
    """A corrupt tier costs a user their upgrade, never their access."""
    await repo.upsert_user("usr_odd", {"tier": "diamond", "listings_used": 0})

    stored_tier, used = await repo.read_quota_doc("usr_odd")

    assert stored_tier == "diamond"
    assert normalise_tier(stored_tier) is Tier.FREE
    assert limit_for(normalise_tier(stored_tier)) == 2
    assert used == 0


# --------------------------------------------------------------------------
# 5-8  atomic quota consumption
# --------------------------------------------------------------------------


async def test_quota_increments_atomically() -> None:
    await repo.create_user_if_absent(a_user("usr_inc", tier=Tier.SILVER))

    assert await repo.consume_quota_atomic("usr_inc", plan_limit=6, count=1)

    _, used = await repo.read_quota_doc("usr_inc")
    assert used == 1


async def test_concurrent_increments_do_not_lose_a_count() -> None:
    """Ten searches at once must spend exactly ten verifications.

    This is the test the whole ``$inc``-in-the-filter design exists for. A
    read-modify-write passes every single-threaded test and quietly loses
    increments here — each caller reads the same value and writes back one more
    than it, so nine of the ten writes vanish.
    """
    await repo.create_user_if_absent(a_user("usr_race", tier=Tier.PREMIUM))

    results = await asyncio.gather(
        *(repo.consume_quota_atomic("usr_race", plan_limit=25, count=1) for _ in range(10))
    )

    assert all(results)
    _, used = await repo.read_quota_doc("usr_race")
    assert used == 10


async def test_quota_refuses_once_the_plan_is_exhausted() -> None:
    await repo.create_user_if_absent(a_user("usr_spent", tier=Tier.FREE))
    assert await repo.consume_quota_atomic("usr_spent", plan_limit=2, count=2)

    refused = await repo.consume_quota_atomic("usr_spent", plan_limit=2, count=1)

    assert refused is False
    _, used = await repo.read_quota_doc("usr_spent")
    assert used == 2, "a refused charge must not move the counter"


async def test_a_multi_listing_charge_cannot_straddle_the_ceiling() -> None:
    """With one left, a request for three is refused rather than partly granted.

    ``$lte: limit - count`` is what makes this true. ``$lt: limit`` would see
    "1 < 2, there is room" and increment straight past the ceiling to 4.
    """
    await repo.create_user_if_absent(a_user("usr_edge", tier=Tier.FREE))
    assert await repo.consume_quota_atomic("usr_edge", plan_limit=2, count=1)

    assert await repo.consume_quota_atomic("usr_edge", plan_limit=2, count=3) is False

    _, used = await repo.read_quota_doc("usr_edge")
    assert used == 1


# --------------------------------------------------------------------------
# 9-12  listings: bulk write and deterministic ordering
# --------------------------------------------------------------------------


async def test_bulk_insert_writes_every_listing() -> None:
    listings = [a_listing(f"lst_{i}", rent=10_000 + i * 100) for i in range(25)]

    written = await repo.save_listings(listings)

    assert written == 25
    assert len(await repo.listings_for_session("ses_1")) == 25


async def test_listings_sort_cheapest_first_on_rent_plus_maintenance() -> None:
    """Rent alone is the deception the product exists to expose.

    ``lst_cheap_rent`` advertises the lowest rent but hides a large maintenance
    charge, so on total monthly outflow it is the *more* expensive of the two.
    """
    await repo.save_listings(
        [
            a_listing("lst_cheap_rent", rent=20_000, maintenance=6_000),  # 26,000
            a_listing("lst_honest", rent=22_000, maintenance=1_000),  # 23,000
        ]
    )

    ordered = await repo.get_listings_by_session("ses_1")

    assert [x.id for x in ordered] == ["lst_honest", "lst_cheap_rent"]
    assert [x.total_monthly_cost for x in ordered] == [23_000, 26_000]


async def test_age_breaks_a_cost_tie_with_the_newer_building_first() -> None:
    await repo.save_listings(
        [
            a_listing("lst_old", rent=20_000, maintenance=0, age_years=12.0),
            a_listing("lst_new", rent=20_000, maintenance=0, age_years=2.0),
        ]
    )

    ordered = await repo.get_listings_by_session("ses_1")

    assert [x.id for x in ordered] == ["lst_new", "lst_old"]


async def test_recrawling_updates_a_listing_rather_than_duplicating_it() -> None:
    """``UpdateOne(upsert=True)`` is why a second crawl is not a second row."""
    await repo.save_listings([a_listing("lst_same", rent=20_000)])
    await repo.save_listings([a_listing("lst_same", rent=18_500)])

    stored = await repo.listings_for_session("ses_1")

    assert len(stored) == 1
    assert stored[0].rent == 18_500


# --------------------------------------------------------------------------
# 13-14  sessions and verifications
# --------------------------------------------------------------------------


async def test_a_session_round_trips_through_the_database() -> None:
    """``_id`` maps back onto ``id``, and the timestamp comes back tz-aware."""
    await repo.save_session(a_session("ses_round"))

    loaded = await repo.get_session("ses_round")

    assert loaded is not None
    assert loaded.id == "ses_round"
    assert loaded.prompt == "2BHK in Kondapur under 25000"
    # BSON drops tzinfo on write; `as_utc` puts it back, and without that every
    # later comparison against utcnow() raises.
    assert loaded.created_at.tzinfo is not None


async def test_one_verification_per_listing_per_session() -> None:
    """A retried call overwrites its own record instead of contradicting it."""
    await repo.save_verification("ses_1", a_verification("lst_v"))

    second = a_verification("lst_v")
    second.call_status = CallStatus.NO_ANSWER.value
    await repo.save_verification("ses_1", second)

    found = await repo.get_session_verifications("ses_1")

    assert len(found) == 1
    assert found[0].call_status == CallStatus.NO_ANSWER.value
    assert found[0].listing_id == "lst_v"


# --------------------------------------------------------------------------
# 15-16  agency leads
# --------------------------------------------------------------------------


async def test_an_agency_lead_is_stored_durably_with_status_new() -> None:
    """Durable before notified: a dropped webhook must not lose the lead."""
    lead = AgencyLead(
        id="lead_1", email="ops@agency.example", notes="40 a day", source="pricing_page"
    )

    await repo.save_agency_lead(lead)

    stored = await repo.get_agency_lead("lead_1")
    assert stored is not None
    assert stored.email == "ops@agency.example"
    assert stored.status == "new"
    assert stored.notified is False
    assert stored.created_at.tzinfo is not None


async def test_lead_notification_outcome_is_recorded() -> None:
    await repo.save_agency_lead(AgencyLead(id="lead_2", email="two@agency.example"))

    await repo.mark_lead_notified("lead_2", delivered=True, detail="emailed ops@khoj")

    stored = await repo.get_agency_lead("lead_2")
    assert stored is not None
    assert stored.notified is True
    assert stored.notification_detail == "emailed ops@khoj"
