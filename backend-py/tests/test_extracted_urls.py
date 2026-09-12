"""A link or a photograph is used only if the page really had it.

The phone numbers were already held to this standard. Links and images were
not, and they are the two fields where a fabrication is quietest: a wrong rent
is caught the moment she reads it, but a wrong link looks right until it 404s,
and a wrong photograph is simply believed — she travels across the city
expecting the flat in the picture.

A model reading a page full of property links will happily produce one more in
the same shape. Checking it appears in the page costs a substring scan.
"""

from __future__ import annotations

from app.llm.extractor import _url_on_page
from app.models import SearchCriteria
from app.scraping.sites import SITES, resolve_targets

PAGE = (
    "2 BHK in Yelahanka. https://www.nobroker.in/property/2-bhk-yelahanka/abc123/detail "
    "Photo: https://cdn.nobroker.in/images/abc123.jpg — rent 25000."
)


def test_a_link_on_the_page_is_kept() -> None:
    url = "https://www.nobroker.in/property/2-bhk-yelahanka/abc123/detail"
    assert _url_on_page(url, PAGE) == url


def test_a_link_that_was_never_on_the_page_is_dropped() -> None:
    """Same shape as the real one, same host, and entirely invented."""
    assert _url_on_page("https://www.nobroker.in/property/2-bhk-yelahanka/zzz999/detail", PAGE) is None


def test_an_image_on_the_page_is_kept() -> None:
    url = "https://cdn.nobroker.in/images/abc123.jpg"
    assert _url_on_page(url, PAGE) == url


def test_a_javascript_url_is_refused_even_if_present() -> None:
    """This value reaches an href, where javascript: executes on click."""
    page = "click javascript:alert(document.cookie) here"
    assert _url_on_page("javascript:alert(document.cookie)", page) is None


def test_a_data_url_is_refused_even_if_present() -> None:
    """data: can carry an SVG with script inside it."""
    page = "src=data:image/svg+xml;base64,PHN2Zz48c2NyaXB0Pg=="
    assert _url_on_page("data:image/svg+xml;base64,PHN2Zz48c2NyaXB0Pg==", page) is None


def test_nothing_in_nothing_out() -> None:
    assert _url_on_page(None, PAGE) is None
    assert _url_on_page("", PAGE) is None
    assert _url_on_page("   ", PAGE) is None


# --------------------------------------------------------------------------
# search URLs
# --------------------------------------------------------------------------


def test_nobroker_keys_on_locality_and_city() -> None:
    """The city alone answers 410 Gone; the underscore is load-bearing.

    Measured on 2026-09-11:
        /2bhk-flats-for-rent-in-yelahanka_bangalore   200
        /2bhk-flats-for-rent-in-bangalore             410
    """
    url = SITES["nobroker"].search_url("Bangalore", locality="Yelahanka", city="Bangalore")
    assert url == "https://www.nobroker.in/2bhk-flats-for-rent-in-yelahanka_bangalore"


def test_realestateindia_puts_the_city_in_its_own_segment() -> None:
    url = SITES["realestateindia"].search_url(
        "Bangalore", locality="Yelahanka", city="Bangalore"
    )
    assert url == (
        "https://www.realestateindia.com/bangalore-property"
        "/2-bhk-flats-apartments-for-rent-in-yelahanka-ffid.htm"
    )


def test_resolve_targets_passes_the_locality_through() -> None:
    """The regression that produced a 410: only the city reached the URL."""
    criteria = SearchCriteria(city="Bangalore", localities=["Yelahanka"])
    targets = {t.name: str(t.url) for t in resolve_targets(["nobroker"], criteria)}

    assert "yelahanka" in targets["NoBroker"], targets
    assert targets["NoBroker"].endswith("yelahanka_bangalore")


def test_a_search_with_no_locality_still_builds_a_url() -> None:
    """Nobody should get a traceback because they only named a city."""
    criteria = SearchCriteria(city="Bangalore", localities=[])
    targets = resolve_targets(["nobroker", "realestateindia"], criteria)
    assert len(targets) == 2
    for t in targets:
        assert str(t.url).startswith("https://")


def test_the_portals_that_refused_are_still_registered_as_gated() -> None:
    """Kept so the reason they are unused stays discoverable."""
    for key in ("99acres", "magicbricks", "housing", "olx"):
        assert SITES[key].contact_gated is True
