"""One account must never read another account's rows.

The dashboard and the search history both used to fall back to an unfiltered
query when they could not identify the caller, on the reasoning that a
signed-out demo should not look empty. With ``AUTH_REQUIRED`` off every caller
resolves to the same "anonymous" uid, so that fallback was the normal path, and
it totalled the whole database into one customer's "Listings matched".

These pin the rule directly at the repository: the only reader a request
handler can reach is scoped by customer, and there is no unscoped one left to
reach for by mistake.
"""

from __future__ import annotations

import pytest

from app import repositories as repo
from app.models import SearchCriteria, SearchSession, TargetSite

pytestmark = pytest.mark.usefixtures("mongo_db")


def a_session(session_id: str, customer_id: str | None, matched: int = 0) -> SearchSession:
    return SearchSession(
        id=session_id,
        customer_id=customer_id,
        prompt="2BHK under 25000",
        criteria=SearchCriteria(),
        target_sites=[TargetSite(name="zolo", url="https://zolostays.com/")],
        listings_matched=matched,
    )


async def test_a_customer_reads_only_their_own_sessions() -> None:
    await repo.create_session(a_session("ses_a1", "usr_alice", matched=3))
    await repo.create_session(a_session("ses_a2", "usr_alice", matched=4))
    await repo.create_session(a_session("ses_b1", "usr_bob", matched=99))

    alice = await repo.list_sessions_for_customer("usr_alice", limit=50)

    assert {s.id for s in alice} == {"ses_a1", "ses_a2"}
    # The number the dashboard prints. Bob's 99 must not be in it.
    assert sum(s.listings_matched for s in alice) == 7


async def test_a_customer_with_no_sessions_reads_nothing() -> None:
    await repo.create_session(a_session("ses_b1", "usr_bob", matched=99))

    assert await repo.list_sessions_for_customer("usr_carol", limit=50) == []


async def test_anonymous_sessions_are_not_visible_to_a_named_customer() -> None:
    """A session stored with no owner belongs to nobody, not to everybody."""
    await repo.create_session(a_session("ses_anon", None, matched=50))

    assert await repo.list_sessions_for_customer("usr_alice", limit=50) == []
    assert await repo.list_sessions_for_customer("anonymous", limit=50) == []


def test_there_is_no_unscoped_session_reader() -> None:
    """The footgun is gone, and stays gone.

    A reader with no tenant predicate must not exist within reach of a request
    handler. If one is reintroduced, this fails and says why.
    """
    assert not hasattr(repo, "list_recent_sessions"), (
        "An unscoped session reader is back in app.repositories. Both "
        "customer-facing endpoints previously reached for exactly such a "
        "function on their anonymous branch and leaked every account's data. "
        "Cross-account reads belong behind an admin boundary."
    )
