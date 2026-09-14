"""A search whose portals give nothing says why, and past searches can be found.

The failure these pin was seen on the live site: a search found 82 listings,
80 of them linked to their portals, and the same search two minutes later found
4 — all Khoj's own, none linked — and ended RANKED with no note at all. The
portals had been asked; nothing came back from them; and the screen gave no
reason, so it read as the product having lost its links and its history.
"""

from __future__ import annotations

import pytest

from app import pipeline
from app import repositories as repo
from app.models import (
    KHOJ_SOURCE,
    Listing,
    ListingSourceStatus,
    SearchCriteria,
    SearchSession,
    SessionStatus,
    TargetSite,
    UserProfile,
)
from app.scraping.crawler import PageResult

pytestmark = pytest.mark.usefixtures("mongo_db")


def a_search(sid: str, customer: str | None = "usr_1") -> SearchSession:
    return SearchSession(
        id=sid,
        customer_id=customer,
        prompt="Food preference? Veg. Are you renting or buying? Rent.",
        criteria=SearchCriteria(city="Bengaluru", localities=["Koramangala"]),
        target_sites=[
            TargetSite(name="NoBroker", url="https://www.nobroker.in/koramangala"),
            TargetSite(name="RealEstateIndia", url="https://www.realestateindia.com/koramangala"),
        ],
        include_native=True,
    )


async def a_khoj_listing() -> None:
    await repo.save_listings(
        [
            Listing(
                id="lst_native",
                session_id="ses_owner",
                source_site=KHOJ_SOURCE,
                listed_by_owner=True,
                owner_id="usr_owner",
                title="2BHK in Koramangala",
                locality="Koramangala",
                bedrooms=2,
                rent=30000,
                contact_number="+919000000001",
            )
        ]
    )


def pages(status: ListingSourceStatus, note: str = ""):
    async def fake_crawl(sites):
        return [
            PageResult(site=s, status=status, text="2BHK Rs 30,000 a month " * 60, note=note)
            for s in sites
        ]

    return fake_crawl


async def test_portals_read_but_not_extracted_are_named_in_the_note(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The live case: pages fetched, the listing reader failed on every one."""
    await repo.create_session(a_search("ses_rate"))
    await a_khoj_listing()

    async def rate_limited(**_kwargs):
        raise RuntimeError("429 RESOURCE_EXHAUSTED")

    monkeypatch.setattr(pipeline, "crawl", pages(ListingSourceStatus.OK))
    monkeypatch.setattr(pipeline, "extract_listings", rate_limited)

    await pipeline.run_search(a_search("ses_rate"))

    stored = await repo.get_session("ses_rate")
    assert stored.status is SessionStatus.RANKED, "Khoj's own listings are still worth showing"
    assert len(await repo.listings_for_session("ses_rate")) == 1
    assert "could not be read from NoBroker, RealEstateIndia" in (stored.error or "")
    assert "try the search again" in stored.error


async def test_portals_that_could_not_be_opened_are_listed_with_why(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    await repo.create_session(a_search("ses_blocked"))
    await a_khoj_listing()

    async def must_not_extract(**_kwargs):
        raise AssertionError("nothing was readable, so nothing should be extracted")

    monkeypatch.setattr(pipeline, "crawl", pages(ListingSourceStatus.BLOCKED, "403 Forbidden"))
    monkeypatch.setattr(pipeline, "extract_listings", must_not_extract)

    await pipeline.run_search(a_search("ses_blocked"))

    stored = await repo.get_session("ses_blocked")
    assert stored.status is SessionStatus.RANKED
    assert "None of the listing portals could be read this time" in (stored.error or "")
    assert "NoBroker (blocked)" in stored.error


async def test_a_search_that_got_portal_listings_carries_no_such_note(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The note must mean something: it is absent when the portals delivered."""
    await repo.create_session(a_search("ses_fine"))

    async def one_listing_per_portal(**kwargs):
        name = kwargs["source_site"]
        return [
            Listing(
                id=f"lst_{name.lower()}",
                session_id=kwargs["session_id"],
                source_site=name,
                title="2BHK in Koramangala",
                locality="Koramangala",
                bedrooms=2,
                rent=31000,
                url="https://www.nobroker.in/property/1",
                contact_number="+919000000002",
            )
        ]

    monkeypatch.setattr(pipeline, "crawl", pages(ListingSourceStatus.OK))
    monkeypatch.setattr(pipeline, "extract_listings", one_listing_per_portal)

    await pipeline.run_search(a_search("ses_fine"))

    stored = await repo.get_session("ses_fine")
    assert stored.status is SessionStatus.RANKED
    assert stored.error is None


async def test_search_history_names_each_search_by_place() -> None:
    """Listed by locality and city, not by the questionnaire every search shares."""
    from app.routes.search import list_history

    await repo.create_session(a_search("ses_mine", customer="usr_h"))
    await repo.create_session(a_search("ses_theirs", customer="usr_other"))

    body = await list_history(user=UserProfile(uid="usr_h"), limit=25)

    assert [s["session_id"] for s in body["sessions"]] == ["ses_mine"]
    assert body["sessions"][0]["city"] == "Bengaluru"
    assert body["sessions"][0]["localities"] == ["Koramangala"]
