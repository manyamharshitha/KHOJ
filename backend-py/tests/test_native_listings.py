"""Properties listed on Khoj itself, searched alongside the crawled ones.

A native listing lives in the same ``listings`` collection as anything scraped,
distinguished by ``source_site == KHOJ_SOURCE`` and ``listed_by_owner``. That is
the whole point of the design: ranking, calling, quota and results already read
listings, and none of them had to learn about a second collection.
"""

from __future__ import annotations

import pytest

from app import repositories as repo
from app.models import KHOJ_SOURCE, Listing, SearchCriteria

pytestmark = pytest.mark.usefixtures("mongo_db")


def a_native(
    listing_id: str,
    *,
    locality: str = "Kondapur",
    bedrooms: int | None = 2,
    rent: int | None = 22000,
    owner: str = "usr_owner",
) -> Listing:
    return Listing(
        id=listing_id,
        session_id="ses_owner",
        source_site=KHOJ_SOURCE,
        listed_by_owner=True,
        owner_id=owner,
        title=f"{bedrooms}BHK in {locality}",
        locality=locality,
        bedrooms=bedrooms,
        rent=rent,
        contact_number="+919000000001",
    )


def a_scraped(listing_id: str) -> Listing:
    return Listing(
        id=listing_id,
        session_id="ses_other",
        source_site="zolo",
        title="2BHK in Kondapur",
        locality="Kondapur",
        bedrooms=2,
        rent=22000,
        contact_number="+919000000002",
    )


async def test_native_listings_are_found_by_locality() -> None:
    await repo.save_listings([a_native("lst_1"), a_native("lst_2", locality="Gachibowli")])

    found = await repo.native_listings(SearchCriteria(localities=["Kondapur"]))

    assert [x.id for x in found] == ["lst_1"]


async def test_scraped_listings_are_never_returned_as_native() -> None:
    """The two share a collection, so the filter is what keeps them apart."""
    await repo.save_listings([a_scraped("lst_scraped"), a_native("lst_native")])

    found = await repo.native_listings(SearchCriteria(localities=["Kondapur"]))

    assert [x.id for x in found] == ["lst_native"]


async def test_locality_match_is_case_insensitive() -> None:
    """An owner types 'Kondapur'; a searcher types 'kondapur'."""
    await repo.save_listings([a_native("lst_1", locality="Kondapur")])

    found = await repo.native_listings(SearchCriteria(localities=["kondapur"]))

    assert [x.id for x in found] == ["lst_1"]


async def test_city_alone_matches_when_no_locality_given() -> None:
    await repo.save_listings([a_native("lst_1", locality="Hyderabad")])

    found = await repo.native_listings(SearchCriteria(city="Hyderabad"))

    assert [x.id for x in found] == ["lst_1"]


async def test_one_bedroom_above_the_ask_is_still_offered() -> None:
    """Close enough to be worth showing; a 4BHK is not."""
    await repo.save_listings(
        [
            a_native("lst_2bhk", bedrooms=2),
            a_native("lst_3bhk", bedrooms=3),
            a_native("lst_4bhk", bedrooms=4),
        ]
    )

    found = await repo.native_listings(SearchCriteria(localities=["Kondapur"], bedrooms=2))

    assert {x.id for x in found} == {"lst_2bhk", "lst_3bhk"}


async def test_a_listing_with_no_rent_survives_a_budget_filter() -> None:
    """Unstated is not the same as unaffordable, and must not be dropped here."""
    await repo.save_listings(
        [
            a_native("lst_cheap", rent=18000),
            a_native("lst_dear", rent=90000),
            a_native("lst_unknown", rent=None),
        ]
    )

    found = await repo.native_listings(
        SearchCriteria(localities=["Kondapur"], max_total_monthly=25000)
    )

    assert {x.id for x in found} == {"lst_cheap", "lst_unknown"}


async def test_no_native_listings_is_an_empty_list_not_an_error() -> None:
    assert await repo.native_listings(SearchCriteria(localities=["Nowhere"])) == []


async def test_a_manual_listing_is_stamped_as_native() -> None:
    """What the add-a-listing endpoint writes must be findable by a search.

    Adding a property by hand and having it stay invisible to the search on the
    next screen was never a sensible reading of "add a listing".
    """
    listing = a_native("lst_1")
    await repo.save_listings([listing])

    stored = await repo.get_listing("lst_1")
    assert stored.source_site == KHOJ_SOURCE
    assert stored.listed_by_owner is True
    assert stored.owner_id == "usr_owner"
    assert stored.is_callable is True
