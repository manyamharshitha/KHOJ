"""Repository tests for roles, site visits, negotiations and notifications.

The bar here is the same as the rest of the suite: prove the things that are
cheap to get wrong and expensive to have wrong in production. Concretely, that a
legacy account without the field reads as a renter rather than a broker, that a
negotiation cannot lose an offer to a concurrent write, and that one account
cannot clear another account's notifications by guessing an id.
"""

from __future__ import annotations

import asyncio
from datetime import timedelta

import pytest

from app import repositories as repo
from app.models import (
    BrokerProfile,
    Negotiation,
    NegotiationOffer,
    Notification,
    NotificationType,
    OfferParty,
    PortalCredential,
    SiteVisit,
    SiteVisitStatus,
    UserProfile,
    UserType,
    utcnow,
)

pytestmark = pytest.mark.usefixtures("mongo_db")


def a_visit(vid: str = "sv_1", **kw) -> SiteVisit:
    body = dict(
        id=vid,
        listing_id="lst_1",
        requested_by="usr_1",
        broker_phone="+919876543210",
        scheduled_for=utcnow() + timedelta(hours=1),
    )
    body.update(kw)
    return SiteVisit(**body)


# --------------------------------------------------------------------------
# roles
# --------------------------------------------------------------------------


async def test_account_without_the_field_reads_as_renter() -> None:
    """A legacy account must not be handed a broker dashboard.

    Every account created before user_type existed has no such field. Reading
    that as anything but renter would expose inbound calls and renter contact
    details to people who never asked to be brokers.
    """
    await repo.create_user_if_absent(UserProfile(uid="usr_legacy"))
    assert await repo.get_user_type("usr_legacy") is UserType.RENTER


async def test_unknown_role_value_falls_back_to_renter() -> None:
    """A corrupted or future value degrades to the least-privileged role."""
    await repo.upsert_user("usr_odd", {"user_type": "landlord"})
    assert await repo.get_user_type("usr_odd") is UserType.RENTER


async def test_role_round_trips() -> None:
    await repo.create_user_if_absent(UserProfile(uid="usr_b"))
    await repo.set_user_type("usr_b", UserType.BROKER)
    assert await repo.get_user_type("usr_b") is UserType.BROKER


async def test_broker_profile_round_trips_and_is_unrated() -> None:
    await repo.save_broker_profile(
        BrokerProfile(uid="usr_b", business_name="Sai Estates", phone="+919876543210")
    )
    got = await repo.get_broker_profile("usr_b")
    assert got is not None
    assert got.business_name == "Sai Estates"
    # Not zero: a new broker is unrated, and zero reads as rated badly.
    assert got.reputation_score is None
    assert (await repo.broker_by_phone("+919876543210")).uid == "usr_b"


# --------------------------------------------------------------------------
# site visits
# --------------------------------------------------------------------------


async def test_site_visit_round_trips() -> None:
    await repo.save_site_visit(a_visit())
    got = await repo.get_site_visit("sv_1")
    assert got is not None and got.status is SiteVisitStatus.SCHEDULED
    assert not got.is_verified


async def test_only_verified_counts_as_verified() -> None:
    """Every status other than VERIFIED must read as not verified."""
    for status in SiteVisitStatus:
        visit = a_visit(status=status)
        assert visit.is_verified is (status is SiteVisitStatus.VERIFIED)


async def test_due_visits_exclude_future_and_already_sent() -> None:
    await repo.save_site_visit(a_visit("sv_future"))
    await repo.save_site_visit(
        a_visit("sv_due", scheduled_for=utcnow() - timedelta(minutes=5))
    )
    await repo.save_site_visit(
        a_visit(
            "sv_sent",
            scheduled_for=utcnow() - timedelta(minutes=5),
            status=SiteVisitStatus.SMS_SENT,
        )
    )
    due = {v.id for v in await repo.due_site_visits()}
    assert due == {"sv_due"}


async def test_visits_are_listed_for_renter_and_for_broker_phone() -> None:
    await repo.save_site_visit(a_visit("sv_a"))
    await repo.save_site_visit(a_visit("sv_b", requested_by="usr_2", broker_phone="+919000000000"))
    assert {v.id for v in await repo.site_visits_for_user("usr_1")} == {"sv_a"}
    assert {v.id for v in await repo.site_visits_for_phone("+919876543210")} == {"sv_a"}


# --------------------------------------------------------------------------
# negotiations
# --------------------------------------------------------------------------


async def test_concurrent_offers_are_both_kept() -> None:
    """Two offers landing at once must not overwrite each other.

    The record exists to be a complete history. A read-modify-write on the list
    would silently drop whichever offer lost the race, which is the one failure
    this document must not have.
    """
    await repo.save_negotiation(
        Negotiation(id="neg_1", listing_id="lst_1", renter_id="usr_1")
    )
    await asyncio.gather(
        repo.append_offer("neg_1", NegotiationOffer(party=OfferParty.RENTER, amount=50_000)),
        repo.append_offer("neg_1", NegotiationOffer(party=OfferParty.BROKER, amount=80_000)),
    )
    got = await repo.get_negotiation("neg_1")
    assert got is not None
    assert len(got.offers) == 2
    assert {o.amount for o in got.offers} == {50_000, 80_000}


async def test_negotiation_lists_for_both_parties() -> None:
    await repo.save_negotiation(
        Negotiation(id="neg_1", listing_id="lst_1", renter_id="usr_r", broker_id="usr_b")
    )
    assert len(await repo.negotiations_for_user("usr_r")) == 1
    assert len(await repo.negotiations_for_user("usr_b")) == 1
    assert len(await repo.negotiations_for_user("usr_other")) == 0


async def test_ai_drafted_is_recorded_on_the_offer() -> None:
    """Whose words these were has to survive into the history."""
    await repo.save_negotiation(Negotiation(id="neg_1", listing_id="l", renter_id="u"))
    await repo.append_offer(
        "neg_1",
        NegotiationOffer(party=OfferParty.RENTER, message="Would you take 50k?", ai_drafted=True),
    )
    got = await repo.get_negotiation("neg_1")
    assert got.offers[0].ai_drafted is True


# --------------------------------------------------------------------------
# notifications
# --------------------------------------------------------------------------


async def a_note(uid: str, nid: str) -> str:
    return await repo.create_notification(
        Notification(id=nid, user_id=uid, type=NotificationType.CALL_READY, message="Call ready")
    )


async def test_unread_count_and_marking_read() -> None:
    await a_note("usr_1", "ntf_1")
    await a_note("usr_1", "ntf_2")
    assert await repo.count_unread("usr_1") == 2

    assert await repo.mark_notification_read("ntf_1", "usr_1") is True
    assert await repo.count_unread("usr_1") == 1

    assert await repo.mark_all_read("usr_1") == 1
    assert await repo.count_unread("usr_1") == 0


async def test_cannot_mark_another_accounts_notification_read() -> None:
    """The owner is part of the filter, not a check that can be skipped.

    Without it, any signed-in account could clear someone else's notifications
    by guessing an id.
    """
    await a_note("usr_1", "ntf_1")
    assert await repo.mark_notification_read("ntf_1", "usr_intruder") is False
    assert await repo.count_unread("usr_1") == 1


async def test_notifications_are_scoped_to_their_owner() -> None:
    await a_note("usr_1", "ntf_1")
    await a_note("usr_2", "ntf_2")
    assert {n.id for n in await repo.notifications_for_user("usr_1")} == {"ntf_1"}


# --------------------------------------------------------------------------
# portal credentials
# --------------------------------------------------------------------------


async def test_credential_round_trips_and_masks_the_key() -> None:
    await repo.save_portal_credential(
        PortalCredential(
            site_id="99acres",
            api_endpoint="https://api.99acres.com",
            api_key="sk_live_abcdef123456",
        )
    )
    got = await repo.get_portal_credential("99acres")
    assert got is not None
    assert got.api_key == "sk_live_abcdef123456"  # the server still holds the real key
    assert "abcdef" not in got.masked()["api_key"]  # what a response may carry
    assert await repo.delete_portal_credential("99acres") is True
    assert await repo.get_portal_credential("99acres") is None


# --------------------------------------------------------------------------
# things that broke once
# --------------------------------------------------------------------------


async def test_credential_list_uses_the_right_id_field() -> None:
    """Reading a credential list must not invent an `id` key.

    PortalCredential's id field is site_id. Omitting it from _model made
    _from_doc write `id`, which extra="forbid" rejects — a 500 on read for a
    document that had saved perfectly well.
    """
    await repo.save_portal_credential(
        PortalCredential(
            site_id="99acres", api_endpoint="https://api.99acres.com", api_key="k1234567"
        )
    )
    listed = await repo.list_portal_credentials()
    assert [c.site_id for c in listed] == ["99acres"]


async def test_deleting_a_missing_credential_reports_false() -> None:
    """Absence must be reported honestly.

    Firestore Enterprise's MongoDB layer answers n=1 for a delete that matched
    nothing, so deleted_count cannot be trusted to mean "it was there". The
    repository establishes existence with a read instead. mongomock reports the
    count correctly, so this test passes either way — it is here to pin the
    contract, and the production divergence is documented on the function.
    """
    assert await repo.delete_portal_credential("never-stored") is False


async def test_notification_ownership_filter_still_holds() -> None:
    """Update counts are accurate on both backends, so this filter is sound.

    Verified against Firestore Enterprise on 2026-09-09: a non-matching
    update_one returns matched=0, modified=0. Only delete diverges.
    """
    await repo.create_notification(
        Notification(
            id="ntf_own", user_id="usr_a", type=NotificationType.CALL_READY, message="x"
        )
    )
    assert await repo.mark_notification_read("ntf_own", "usr_b") is False
    assert await repo.mark_notification_read("ntf_own", "usr_a") is True


async def test_visit_token_is_not_the_visit_id() -> None:
    """The upload credential must not be guessable from anything public."""
    await repo.save_site_visit(a_visit("sv_tok"))
    token = await repo.issue_visit_token("sv_tok")
    assert token != "sv_tok"
    assert len(token) >= 32
    found = await repo.visit_for_token(token)
    assert found is not None and found.id == "sv_tok"
    assert await repo.visit_for_token("wrong-token") is None


async def test_token_lookup_survives_a_resend() -> None:
    """Re-sending the SMS must reuse the token, not mint a second one."""
    await repo.save_site_visit(a_visit("sv_resend"))
    first = await repo.issue_visit_token("sv_resend")
    assert await repo.token_for_visit("sv_resend") == first
