"""Search history says what each entry is, without the prompt behind it.

Seen live: the history row showed the newest eight searches, and four of them
were listings added by hand — each stored as a one-listing "search" whose prompt
was the setup answers ("Food preference? Veg. Are you renting…"), or on older
ones "Listing added by hand: +91…" with the broker's phone number. The row read
as four identical entries, and the searches with real results were pushed out.
"""

from __future__ import annotations

import pytest

from app import repositories as repo
from app.models import SearchCriteria, SearchSession, SessionStatus, TargetSite, UserProfile
from app.routes.listings import MANUAL_PLACEHOLDER_URL, MANUAL_SOURCE
from app.routes.search import list_history

pytestmark = pytest.mark.usefixtures("mongo_db")


async def test_hand_added_listings_are_flagged_and_searches_are_not() -> None:
    await repo.create_session(
        SearchSession(
            id="ses_portal",
            customer_id="usr_hist",
            prompt="Food preference? Veg. Are you renting or buying? Rent.",
            criteria=SearchCriteria(city="Bengaluru", localities=["Yelahanka"]),
            target_sites=[TargetSite(name="NoBroker", url="https://www.nobroker.in/yelahanka")],
            status=SessionStatus.RANKED,
            listings_found=60,
        )
    )
    await repo.create_session(
        SearchSession(
            id="ses_by_hand",
            customer_id="usr_hist",
            prompt="Listing added by hand: +919000000123",
            criteria=SearchCriteria(),
            target_sites=[
                TargetSite(name=MANUAL_SOURCE, url=MANUAL_PLACEHOLDER_URL, contact_gated=False)
            ],
            status=SessionStatus.RANKED,
            listings_found=1,
        )
    )

    body = await list_history(user=UserProfile(uid="usr_hist"), limit=25)
    by_id = {s["session_id"]: s for s in body["sessions"]}

    assert by_id["ses_by_hand"]["manual"] is True
    assert by_id["ses_portal"]["manual"] is False
    assert by_id["ses_portal"]["localities"] == ["Yelahanka"]
    assert by_id["ses_portal"]["listings_found"] == 60


async def test_a_larger_history_can_be_asked_for() -> None:
    """The page asks for 25 so searches with results are not crowded out."""
    for i in range(12):
        await repo.create_session(
            SearchSession(
                id=f"ses_many_{i:02d}",
                customer_id="usr_many",
                prompt="2BHK",
                criteria=SearchCriteria(city="Hyderabad", localities=["Kondapur"]),
                target_sites=[TargetSite(name="NoBroker", url="https://www.nobroker.in/kondapur")],
            )
        )

    body = await list_history(user=UserProfile(uid="usr_many"), limit=25)
    assert body["count"] == 12
