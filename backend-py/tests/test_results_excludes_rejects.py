"""A stated budget is the one number the customer is entitled to have kept.

The pipeline stores rejected listings alongside the matches on purpose — it
writes the reason onto each so the customer can be told *why* a property was
dropped, rather than watching results silently thin out. `read_results` then
handed the whole collection back as results.

The effect: someone who said nothing over Rs 30,000 was shown Rs 42,000 flats,
each carrying an "Excluded: over your Rs 30,000 ceiling" note the screen never
displayed. Worse, the session said `listings_matched: 16` while the endpoint
returned 25, so the count and the list disagreed and neither was obviously the
liar.
"""

from __future__ import annotations

import pytest

from app.models import Listing, SearchCriteria, SearchSession, SessionStatus, TargetSite
from app.routes.search import read_results

pytestmark = pytest.mark.anyio


def listing(id_: str, rent: int, *, excluded_because: str | None = None) -> Listing:
    return Listing(
        id=id_,
        session_id="ses_budget",
        source_site="NoBroker",
        locality="Koramangala",
        bedrooms=2,
        rent=rent,
        ai_match_reason=f"Excluded: {excluded_because}" if excluded_because else "Good fit",
    )


@pytest.fixture
async def a_session_with_rejects(mongo_db):
    """Three affordable flats and two the customer ruled out."""
    from app.repositories import create_session, save_listings

    session = SearchSession(
        id="ses_budget",
        customer_id="usr_1",
        prompt="2BHK under 30k",
        criteria=SearchCriteria(city="Bangalore", localities=["Koramangala"], bedrooms=2),
        target_sites=[TargetSite(name="NoBroker", url="https://www.nobroker.in/")],
    )
    await create_session(session)
    await save_listings(
        [
            listing("ok_1", 12_000),
            listing("ok_2", 20_000),
            listing("ok_3", 28_000),
            listing("over_1", 42_000, excluded_because="Rs 42,000/month is over your Rs 30,000 ceiling"),
            listing("over_2", 35_000, excluded_because="Rs 35,000/month is over your Rs 30,000 ceiling"),
        ]
    )
    return session


async def test_a_property_over_the_ceiling_is_not_a_result(a_session_with_rejects) -> None:
    """The bug, exactly: a Rs 42,000 flat answering a Rs 30,000 search."""
    out = await read_results("ses_budget")
    returned = {r.listing.id for r in out.results}

    assert "over_1" not in returned
    assert "over_2" not in returned


async def test_the_matches_are_all_returned(a_session_with_rejects) -> None:
    out = await read_results("ses_budget")
    assert {r.listing.id for r in out.results} == {"ok_1", "ok_2", "ok_3"}


async def test_the_rejects_are_offered_separately_with_their_reasons(
    a_session_with_rejects,
) -> None:
    """Kept in the payload, because "two more, just over budget" is worth
    offering — as a choice she makes, not a result she has to sift."""
    out = await read_results("ses_budget")

    assert {r.listing.id for r in out.excluded} == {"over_1", "over_2"}
    for row in out.excluded:
        assert (row.listing.ai_match_reason or "").startswith("Excluded:")


async def test_nothing_appears_in_both_lists(a_session_with_rejects) -> None:
    out = await read_results("ses_budget")
    assert not {r.listing.id for r in out.results} & {r.listing.id for r in out.excluded}


async def test_a_search_with_no_rejects_has_an_empty_excluded_list(mongo_db) -> None:
    """The ordinary case must not grow an empty section on the screen."""
    from app.repositories import create_session, save_listings

    session = SearchSession(
        id="ses_clean",
        customer_id="usr_1",
        prompt="2BHK",
        criteria=SearchCriteria(city="Bangalore", bedrooms=2),
        target_sites=[TargetSite(name="NoBroker", url="https://www.nobroker.in/")],
    )
    await create_session(session)
    await save_listings(
        [
            Listing(id="a", session_id="ses_clean", source_site="NoBroker", rent=15_000),
            Listing(id="b", session_id="ses_clean", source_site="NoBroker", rent=18_000),
        ]
    )

    out = await read_results("ses_clean")
    assert len(out.results) == 2
    assert out.excluded == []
