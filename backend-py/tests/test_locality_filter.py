"""A city-wide source must not answer a locality question.

Zolo, Colive and Stanza Living only publish city pages — there is no locality in
the URL to ask with, so `/pgs-in-bangalore` answers with every PG in Bangalore.
Nothing checked the locality afterwards, so a Koramangala search returned PGs in
BTM Layout and HSR Layout, and because the same city page is served for every
search the same few appeared whatever was typed. It read as canned data. It was
a real page, asked the wrong question.

The filter applies only to those sources. NoBroker is asked for
`koramangala_bangalore` and its results are already on target; re-checking a
free-text address against a free-text locality there would discard good flats
over a spelling, which is the opposite of the problem being solved.
"""

from __future__ import annotations

from app.models import Listing, SearchCriteria
from app.ranking import filter_hard_constraints
from app.scraping.sites import is_city_level

KORAMANGALA = SearchCriteria(city="Bangalore", localities=["Koramangala"], bedrooms=2)


def listing(id_: str, source: str, locality: str | None, **over) -> Listing:
    return Listing(
        id=id_,
        session_id="ses_t",
        source_site=source,
        locality=locality,
        bedrooms=2,
        rent=15_000,
        **over,
    )


def kept_ids(rows: list[Listing], criteria: SearchCriteria = KORAMANGALA) -> set[str]:
    kept, _ = filter_hard_constraints(rows, criteria)
    return {x.id for x in kept}


# --------------------------------------------------------------------------
# which sources are city-wide
# --------------------------------------------------------------------------


def test_the_operators_are_known_to_be_city_wide() -> None:
    assert is_city_level("Zolo")
    assert is_city_level("Colive")
    assert is_city_level("Stanza Living")


def test_the_portals_are_not() -> None:
    """Their URLs carry the locality, so they already filtered."""
    assert not is_city_level("NoBroker")
    assert not is_city_level("RealEstateIndia")


def test_an_unknown_source_is_not_treated_as_city_wide() -> None:
    """A pasted URL or a hand-added listing must not be filtered away."""
    assert not is_city_level("Khoj")
    assert not is_city_level(None)
    assert not is_city_level("")


# --------------------------------------------------------------------------
# the filter
# --------------------------------------------------------------------------


def test_a_pg_in_the_wrong_area_is_dropped() -> None:
    """The bug, exactly: BTM Layout answering a Koramangala search."""
    rows = [listing("btm", "Stanza Living", "BTM Layout")]
    assert kept_ids(rows) == set()


def test_a_pg_in_the_right_area_is_kept() -> None:
    rows = [listing("here", "Zolo", "Koramangala")]
    assert kept_ids(rows) == {"here"}


def test_a_block_within_the_locality_still_matches() -> None:
    """"Koramangala 5th Block" is Koramangala.

    An exact comparison fails this, and failing it discards the right flat over
    a suffix.
    """
    rows = [listing("block", "Zolo", "Koramangala 5th Block")]
    assert kept_ids(rows) == {"block"}


def test_a_broader_search_matches_a_narrower_listing() -> None:
    """And the other direction: asked for a block, offered the area."""
    criteria = SearchCriteria(
        city="Bangalore", localities=["Koramangala 5th Block"], bedrooms=2
    )
    rows = [listing("area", "Zolo", "Koramangala")]
    assert kept_ids(rows, criteria) == {"area"}


def test_a_listing_with_no_locality_is_kept() -> None:
    """The unknown is what the phone call is for.

    An operator that omits the area on some cards should not cost the customer
    those properties.
    """
    rows = [listing("noloc", "Colive", None)]
    assert kept_ids(rows) == {"noloc"}


def test_the_locality_may_be_in_the_title_instead() -> None:
    rows = [listing("titled", "Zolo", None, title="Zolo Koramangala — unisex PG")]
    assert kept_ids(rows) == {"titled"}


def test_a_portals_own_results_are_left_alone() -> None:
    """NoBroker's URL already filtered; second-guessing it costs good flats.

    A deliberate trade: a stray "similar property" from another area survives,
    rather than risking the loss of real matches whose address text differs
    from the locality string.
    """
    rows = [listing("nb", "NoBroker", "Whitefield")]
    assert kept_ids(rows) == {"nb"}


def test_nothing_is_filtered_when_no_locality_was_asked_for() -> None:
    """A city-wide search should get city-wide results."""
    criteria = SearchCriteria(city="Bangalore", localities=[], bedrooms=2)
    rows = [
        listing("a", "Zolo", "BTM Layout"),
        listing("b", "Stanza Living", "HSR Layout"),
    ]
    assert kept_ids(rows, criteria) == {"a", "b"}


def test_the_reason_names_the_area_that_was_wrong() -> None:
    """Shown to the customer, so it has to say something she can act on."""
    _, dropped = filter_hard_constraints(
        [listing("btm", "Zolo", "BTM Layout")], KORAMANGALA
    )
    assert len(dropped) == 1
    assert "BTM Layout" in dropped[0][1]


def test_several_localities_all_count() -> None:
    criteria = SearchCriteria(
        city="Bangalore", localities=["Koramangala", "Indiranagar"], bedrooms=2
    )
    rows = [
        listing("k", "Zolo", "Koramangala"),
        listing("i", "Zolo", "Indiranagar"),
        listing("w", "Zolo", "Whitefield"),
    ]
    assert kept_ids(rows, criteria) == {"k", "i"}
