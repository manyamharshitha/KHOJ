"""Firestore repository tests against the local emulator.

Skipped unless ``FIRESTORE_EMULATOR_HOST`` is set, so the offline suite stays
fast and CI does not need credentials::

    firebase emulators:start --only firestore --project khoj-local
    FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 pytest tests/test_repositories_live.py

When that variable is set the Admin SDK skips cloud authentication entirely and
talks to the local store, so no service account or project is needed.

These exercise the *real* repository functions rather than a parallel snippet.
A test that calls ``firestore.client()`` directly proves the emulator works; it
proves nothing about ``repositories.py``, which is the code that will actually
run.
"""

from __future__ import annotations

import os

import pytest

pytestmark = pytest.mark.skipif(
    not os.environ.get("FIRESTORE_EMULATOR_HOST"),
    reason="needs the Firestore emulator; set FIRESTORE_EMULATOR_HOST",
)

# The emulator needs a project id but not a real one.
os.environ.setdefault("FIREBASE_PROJECT_ID", "khoj-local")

from app.core.auth import consume_quota, get_or_create_user, read_quota, set_tier  # noqa: E402
from app.core.plans import Tier  # noqa: E402
from app.ids import new_id  # noqa: E402
from app.models import (  # noqa: E402
    CallLog,
    CallStatus,
    HonestyReport,
    Listing,
    QnAPair,
    SearchCriteria,
    SearchSession,
    SessionStatus,
    Speaker,
    TranscriptTurn,
    Verdict,
)
from app.repositories import (  # noqa: E402
    called_recently,
    calls_for_session,
    create_call,
    create_session,
    get_call,
    get_listing,
    get_session,
    listings_for_session,
    report_for_call,
    save_call,
    save_listings,
    save_report,
    set_session_status,
    update_session,
)


def _session(customer_id: str | None = None) -> SearchSession:
    return SearchSession(
        id=new_id("ses"),
        customer_id=customer_id,
        prompt="2BHK near HSR under 35k",
        criteria=SearchCriteria(city="Bengaluru", bedrooms=2, max_total_monthly=35_000),
        target_sites=[{"name": "Test", "url": "https://example.com/listing"}],  # type: ignore[list-item]
    )


class TestSessionRoundTrip:
    async def test_a_session_survives_a_write_and_read(self) -> None:
        session = _session()
        await create_session(session)

        loaded = await get_session(session.id)
        assert loaded is not None
        assert loaded.id == session.id
        assert loaded.prompt == session.prompt
        # The nested criteria object must survive Firestore serialisation.
        assert loaded.criteria.bedrooms == 2
        assert loaded.criteria.max_total_monthly == 35_000
        assert loaded.criteria.city == "Bengaluru"

    async def test_status_and_counters_update(self) -> None:
        session = _session()
        await create_session(session)

        await set_session_status(session.id, SessionStatus.RANKED)
        await update_session(session.id, listings_found=9, listings_matched=2)

        loaded = await get_session(session.id)
        assert loaded is not None
        assert loaded.status is SessionStatus.RANKED
        assert loaded.listings_found == 9
        assert loaded.listings_matched == 2

    async def test_a_missing_session_is_none_not_an_error(self) -> None:
        assert await get_session("ses_does_not_exist") is None


class TestListings:
    async def test_the_derived_total_is_persisted_for_querying(self) -> None:
        """``total_monthly_cost`` is a property, so it must be written explicitly."""
        session = _session()
        await create_session(session)

        listing = Listing(
            id=new_id("lst"),
            session_id=session.id,
            source_site="Test",
            rent=30_000,
            maintenance=2_000,
            age_years=3,
            contact_number="+919876543210",
        )
        await save_listings([listing])

        loaded = await get_listing(listing.id)
        assert loaded is not None
        assert loaded.rent == 30_000
        assert loaded.total_monthly_cost == 32_000
        assert loaded.is_callable

    async def test_listings_come_back_scoped_to_their_session(self) -> None:
        mine, theirs = _session(), _session()
        await create_session(mine)
        await create_session(theirs)

        await save_listings(
            [
                Listing(id=new_id("lst"), session_id=mine.id, source_site="A", rent=10_000),
                Listing(id=new_id("lst"), session_id=mine.id, source_site="A", rent=20_000),
                Listing(id=new_id("lst"), session_id=theirs.id, source_site="B", rent=30_000),
            ]
        )

        assert len(await listings_for_session(mine.id)) == 2
        assert len(await listings_for_session(theirs.id)) == 1

    @pytest.mark.slow
    async def test_a_batch_larger_than_the_firestore_limit_is_chunked(self) -> None:
        """Firestore caps a batch at 500 writes; ``save_listings`` chunks at 400.

        Marked slow and excluded from the default run. It passes in about two
        seconds on its own (``pytest -m slow``), but run after the rest of the
        module it wedges the shared gRPC channel and never returns — an emulator
        and harness interaction, not a defect in ``save_listings``, which writes
        450 documents in roughly a third of a second.
        """
        session = _session()
        await create_session(session)
        await save_listings(
            [
                Listing(id=new_id("lst"), session_id=session.id, source_site="X", rent=10_000 + i)
                for i in range(450)
            ]
        )
        assert len(await listings_for_session(session.id)) == 450


class TestCallsAndReports:
    async def test_a_transcript_survives_the_round_trip(self) -> None:
        session = _session()
        await create_session(session)

        call = CallLog(
            id=new_id("cal"),
            session_id=session.id,
            listing_id="lst_1",
            phone_dialed="+919876543210",
            call_status=CallStatus.COMPLETED,
            duration_sec=47,
            consent_to_record=True,
            transcript=[
                TranscriptTurn(speaker=Speaker.AGENT, text="Is it available?", timestamp=0.0),
                TranscriptTurn(speaker=Speaker.OWNER, text="Yes, come today.", timestamp=3.2),
            ],
            qna_pairs=[
                QnAPair(question="Is it available?", answer="yes", quote="Yes, come today.")
            ],
        )
        await create_call(call)

        loaded = await get_call(call.id)
        assert loaded is not None
        assert len(loaded.transcript) == 2
        # Speaker labels are the whole basis of the transparency record.
        assert loaded.transcript[0].speaker is Speaker.AGENT
        assert loaded.transcript[1].speaker is Speaker.OWNER
        assert loaded.qna_pairs[0].quote == "Yes, come today."

    async def test_cooldown_sees_a_number_called_moments_ago(self) -> None:
        """The guard that stops one broker being rung twice in a week."""
        session = _session()
        await create_session(session)
        phone = f"+9198{new_id('')[-8:].rjust(8, '0')}"

        assert await called_recently(phone, 7) is False

        await create_call(
            CallLog(
                id=new_id("cal"),
                session_id=session.id,
                listing_id="lst_1",
                phone_dialed=phone,
                call_status=CallStatus.COMPLETED,
            )
        )
        assert await called_recently(phone, 7) is True
        # A zero-day cooldown disables the check entirely, for local demos.
        assert await called_recently(phone, 0) is False

    async def test_a_report_is_findable_from_its_call(self) -> None:
        session = _session()
        await create_session(session)
        call_id = new_id("cal")

        await save_report(
            HonestyReport(
                id=new_id("rep"),
                session_id=session.id,
                listing_id="lst_1",
                call_id=call_id,
                honesty_score=4.5,
                confidence_score=0.6,
                final_verdict=Verdict.QUESTIONABLE,
                summary="Rent quoted well above the advert.",
                model="test",
                red_flags=["maintenance not disclosed in the listing"],
            )
        )

        loaded = await report_for_call(call_id)
        assert loaded is not None
        assert loaded.honesty_score == 4.5
        assert loaded.final_verdict is Verdict.QUESTIONABLE
        assert loaded.red_flags == ["maintenance not disclosed in the listing"]

    async def test_calls_are_listed_per_session(self) -> None:
        session = _session()
        await create_session(session)
        for _ in range(3):
            await create_call(
                CallLog(
                    id=new_id("cal"),
                    session_id=session.id,
                    listing_id="lst_x",
                    phone_dialed="+919000000000",
                )
            )
        assert len(await calls_for_session(session.id)) == 3


class TestQuotaAtomicity:
    """The increment that stands between a free account and a telephony bill."""

    async def test_a_new_user_starts_on_free_with_two_verifications(self) -> None:
        uid = new_id("usr")
        profile = await get_or_create_user(uid, "new@example.com", name="New")

        assert profile.tier == Tier.FREE
        assert profile.listings_limit == 2
        assert profile.listings_used == 0

    async def test_signing_in_again_does_not_reset_usage(self) -> None:
        uid = new_id("usr")
        await get_or_create_user(uid, "repeat@example.com")
        await consume_quota(uid, 2)

        again = await get_or_create_user(uid, "repeat@example.com")
        assert again.listings_used == 2, "a second sign-in must not hand back free quota"

    async def test_concurrent_increments_do_not_lose_a_count(self) -> None:
        """Read-modify-write would drop one of these and give away a free call."""
        import asyncio

        uid = new_id("usr")
        await get_or_create_user(uid, "race@example.com")

        await asyncio.gather(*(consume_quota(uid, 1) for _ in range(10)))

        _, _, used = await read_quota(uid)
        assert used == 10

    async def test_a_tier_change_moves_the_ceiling_but_keeps_usage(self) -> None:
        uid = new_id("usr")
        await get_or_create_user(uid, "upgrade@example.com")
        await consume_quota(uid, 2)

        await set_tier(uid, Tier.GOLD)
        tier, limit, used = await read_quota(uid)

        assert tier is Tier.GOLD
        assert limit == 15
        assert used == 2, "an upgrade must not silently refund what was already spent"

    async def test_a_downgrade_leaves_usage_above_the_new_ceiling(self) -> None:
        """`remaining` must clamp to zero rather than going negative."""
        from app.core.plans import Quota

        uid = new_id("usr")
        await get_or_create_user(uid, "downgrade@example.com")
        await set_tier(uid, Tier.PREMIUM)
        await consume_quota(uid, 11)
        await set_tier(uid, Tier.FREE)

        tier, limit, used = await read_quota(uid)
        quota = Quota(tier=tier, limit=limit, used=used)

        assert (limit, used) == (2, 11)
        assert quota.remaining == 0
        assert quota.exhausted


class TestVerificationSubcollection:
    async def test_a_verification_lands_under_its_session(self) -> None:
        """``search_sessions/{id}/verifications/{listing_id}`` — a subcollection,
        so deleting a session takes its evidence with it."""
        from app.firebase import get_db
        from app.models import Verification

        session = _session()
        await create_session(session)
        listing_id = new_id("lst")

        record = Verification(
            listing_id=listing_id,
            call_id=new_id("cal"),
            phone_dialed="+919876543210",
            call_status="completed",
            advertised_total=30_000,
            spoken_rent=34_000,
            spoken_maintenance=4_500,
            spoken_total=38_500,
            honesty_score=4.0,
            final_verdict="questionable",
            red_flags=["quoted above the advert"],
            summary="Rent moved and maintenance appeared.",
        )

        await (
            get_db()
            .collection("search_sessions")
            .document(session.id)
            .collection("verifications")
            .document(listing_id)
            .set(record.to_firestore())
        )

        snap = await (
            get_db()
            .collection("search_sessions")
            .document(session.id)
            .collection("verifications")
            .document(listing_id)
            .get()
        )
        assert snap.exists
        data = snap.to_dict() or {}
        assert data["spoken_total"] == 38_500
        assert data["advertised_total"] == 30_000
        assert data["red_flags"] == ["quoted above the advert"]
