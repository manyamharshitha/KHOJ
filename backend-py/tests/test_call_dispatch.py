"""The call rows must exist before the request that triggers them returns.

Creating the CallLog inside the background task left a window in which a listing
existed and its call did not. The browser navigates to the results the instant
the 202 lands, read ``call: null``, and rendered that as "scheduled" — a call
that was about to ring looked like one merely booked, and nothing corrected it.

These prove the row is written synchronously, carries DIALING rather than the
QUEUED default, and that a number inside its cooldown is reserved as BLOCKED so
it is never shown as ringing.
"""

from __future__ import annotations

import pytest

from app import repositories as repo
from app.config import settings
from app.models import (
    CallStatus,
    Listing,
    SearchCriteria,
    SearchSession,
    TargetSite,
    utcnow,
)
from app.pipeline import abandon_reserved, reserve_calls, run_calls
from app.telephony.calle_dialer import _map_status

pytestmark = pytest.mark.usefixtures("mongo_db")


def a_listing(listing_id: str, phone: str | None = "+919000000001") -> Listing:
    return Listing(
        id=listing_id,
        session_id="ses_call",
        source_site="nobroker",
        title=f"Flat {listing_id}",
        rent=25000,
        contact_number=phone,
    )


def a_session() -> SearchSession:
    return SearchSession(
        id="ses_call",
        customer_id="usr_call",
        prompt="2BHK under 25000",
        criteria=SearchCriteria(),
        target_sites=[TargetSite(name="nobroker", url="https://www.nobroker.in/")],
    )


async def test_reserve_writes_the_row_before_returning() -> None:
    """The row is readable from the database the moment reserve_calls returns."""
    session = a_session()
    await repo.create_session(session)
    await repo.save_listings([a_listing("lst_1")])

    reserved = await reserve_calls(session, limit=1)

    assert len(reserved) == 1
    _, call = reserved[0]

    # The point of the whole change: readable by anyone, not just by us.
    stored = await repo.get_call(call.id)
    assert stored is not None
    assert stored.call_status is CallStatus.DIALING


async def test_reserved_row_is_visible_to_the_results_query() -> None:
    """calls_for_session is what GET /results reads, so it must see the row."""
    session = a_session()
    await repo.create_session(session)
    await repo.save_listings([a_listing("lst_1")])

    await reserve_calls(session, limit=1)

    calls = await repo.calls_for_session("ses_call")
    assert [c.listing_id for c in calls] == ["lst_1"]
    # `queued` here is what the UI renders as "Scheduled" — the original bug.
    assert calls[0].call_status is not CallStatus.QUEUED


async def test_listing_without_a_number_is_not_reserved() -> None:
    session = a_session()
    await repo.create_session(session)
    await repo.save_listings([a_listing("lst_1", phone=None)])

    assert await reserve_calls(session, limit=5) == []


async def test_limit_caps_the_rows_created() -> None:
    session = a_session()
    await repo.create_session(session)
    await repo.save_listings([a_listing(f"lst_{i}") for i in range(4)])

    reserved = await reserve_calls(session, limit=2)

    assert len(reserved) == 2
    assert len(await repo.calls_for_session("ses_call")) == 2


async def test_number_inside_its_cooldown_reserves_as_blocked(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A number that will not be rung must never be shown as ringing."""
    monkeypatch.setattr(settings, "bypass_call_window", False)

    session = a_session()
    await repo.create_session(session)
    await repo.save_listings([a_listing("lst_1")])

    # An earlier call to the same number, well inside the cooldown window.
    from app.models import CallLog

    await repo.create_call(
        CallLog(
            id="cal_old",
            session_id="ses_old",
            listing_id="lst_old",
            phone_dialed="+919000000001",
            call_status=CallStatus.COMPLETED,
            started_at=utcnow(),
            created_at=utcnow(),
        )
    )

    reserved = await reserve_calls(session, limit=1)

    assert len(reserved) == 1
    _, call = reserved[0]
    assert call.call_status is CallStatus.BLOCKED
    assert (await repo.get_call(call.id)).call_status is CallStatus.BLOCKED


# --------------------------------------------------------------------------
# a reservation that will not be honoured must say so
# --------------------------------------------------------------------------


async def test_abandon_marks_reserved_rows_failed_with_a_reason() -> None:
    """A row left at DIALING shows as "Calling now" for a call that never rang."""
    session = a_session()
    await repo.create_session(session)
    await repo.save_listings([a_listing("lst_1")])
    reserved = await reserve_calls(session, limit=1)

    await abandon_reserved(reserved, "CALLE_API_KEY is not set.")

    stored = await repo.get_call(reserved[0][1].id)
    assert stored.call_status is CallStatus.FAILED
    assert "CALLE_API_KEY" in stored.error


async def test_abandon_leaves_a_blocked_row_alone(monkeypatch: pytest.MonkeyPatch) -> None:
    """BLOCKED already carries a more specific reason than the generic one."""
    monkeypatch.setattr(settings, "bypass_call_window", False)
    from app.models import CallLog

    session = a_session()
    await repo.create_session(session)
    await repo.save_listings([a_listing("lst_1")])
    await repo.create_call(
        CallLog(
            id="cal_prev",
            session_id="ses_old",
            listing_id="lst_old",
            phone_dialed="+919000000001",
            call_status=CallStatus.COMPLETED,
            started_at=utcnow(),
            created_at=utcnow(),
        )
    )
    reserved = await reserve_calls(session, limit=1)

    await abandon_reserved(reserved, "some unrelated reason")

    assert (await repo.get_call(reserved[0][1].id)).call_status is CallStatus.BLOCKED


async def test_outside_the_window_fails_the_rows_rather_than_orphaning_them(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The early return used to leave DIALING rows nobody would ever touch."""
    monkeypatch.setattr(settings, "ignore_call_window", False)
    monkeypatch.setattr(settings, "bypass_call_window", False)
    monkeypatch.setattr("app.pipeline.inside_calling_window", lambda *a, **k: False)

    session = a_session()
    await repo.create_session(session)
    await repo.save_listings([a_listing("lst_1")])
    reserved = await reserve_calls(session, limit=1)

    await run_calls("ses_call", limit=1, reserved=reserved)

    stored = await repo.get_call(reserved[0][1].id)
    assert stored.call_status is CallStatus.FAILED
    assert "calling hours" in stored.error


# --------------------------------------------------------------------------
# NO_ANSWER means it rang and nobody picked up — nothing else
# --------------------------------------------------------------------------


def test_task_that_never_reached_an_attempt_is_failed_not_no_answer() -> None:
    assert _map_status({"status": "completed"}, None) is CallStatus.FAILED


def test_poll_timeout_is_failed_not_no_answer() -> None:
    status = _map_status({"status": "failed"}, {"failure_code": "poll_timeout"})
    assert status is CallStatus.FAILED


def test_a_real_unanswered_ring_is_still_no_answer() -> None:
    status = _map_status({"status": "failed"}, {"failure_code": "no_answer"})
    assert status is CallStatus.NO_ANSWER


# --------------------------------------------------------------------------
# a call that never rang must not spend the allowance
# --------------------------------------------------------------------------


async def _a_call(call_id: str, status: CallStatus, uid: str = "usr_quota") -> None:
    from app.models import CallLog

    await repo.create_call(
        CallLog(
            id=call_id,
            session_id="ses_quota",
            customer_id=uid,
            listing_id=f"lst_{call_id}",
            phone_dialed="+919000000009",
            call_status=status,
            started_at=utcnow(),
            created_at=utcnow(),
        )
    )


async def test_failed_calls_do_not_spend_the_lifetime_allowance() -> None:
    """Two misconfigured attempts used to exhaust the free plan permanently."""
    await _a_call("cal_f1", CallStatus.FAILED)
    await _a_call("cal_f2", CallStatus.FAILED)
    await _a_call("cal_b1", CallStatus.BLOCKED)

    assert await repo.count_calls_ever("usr_quota") == 0


async def test_completed_calls_still_spend_the_lifetime_allowance() -> None:
    await _a_call("cal_ok", CallStatus.COMPLETED)
    await _a_call("cal_na", CallStatus.NO_ANSWER)
    await _a_call("cal_bad", CallStatus.FAILED)

    # A ring nobody picked up did reach the network, so it counts; the failure
    # did not.
    assert await repo.count_calls_ever("usr_quota") == 2


async def test_failed_calls_do_not_spend_the_daily_allowance() -> None:
    from datetime import timedelta

    await _a_call("cal_d1", CallStatus.FAILED)
    since = utcnow() - timedelta(days=1)

    assert await repo.count_calls_since("usr_quota", since) == 0
