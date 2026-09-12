"""Reading a listing page without starting a browser.

This is the path that pulled twenty-five NoBroker listings and twelve from
RealEstateIndia during the 2026-09-11 survey, and there is nothing in it but a
GET and an HTML flatten. It exists as its own path because Chromium wants four
hundred megabytes to reach the same text, which a 512MB instance does not have
— so the browser had been switched off entirely and searches returned only
Khoj's own listings.

The links and images are the part worth guarding. They live in attributes, not
in visible text, and the extractor validates every URL it reports against this
text — so a link this flatten drops is a link the customer never gets.
"""

from __future__ import annotations

from app.scraping.http_reader import HttpPage, html_to_text

BASE = "https://www.nobroker.in/2bhk-flats-for-rent-in-yelahanka_bangalore"


def test_a_relative_listing_link_is_made_absolute() -> None:
    """NoBroker writes `/property/...`, which is not openable or checkable."""
    text = html_to_text('<a href="/property/2-bhk/abc123/detail">2 BHK</a>', BASE)
    assert "https://www.nobroker.in/property/2-bhk/abc123/detail" in text


def test_an_absolute_link_survives_unchanged() -> None:
    url = "https://www.realestateindia.com/property-detail/x-1504740.htm"
    assert url in html_to_text(f'<a href="{url}">Shriram Solitaire</a>', BASE)


def test_an_image_is_kept_with_its_url() -> None:
    text = html_to_text('<img src="https://cdn.nobroker.in/i/abc.jpg" alt="Balcony">', BASE)
    assert "https://cdn.nobroker.in/i/abc.jpg" in text
    assert "Balcony" in text


def test_a_lazy_loaded_photo_prefers_the_real_source() -> None:
    """A gallery puts a grey placeholder in src and the photo in data-src.

    Preferring src collects a page of identical spacers, and every listing then
    shows the same blank grey image.
    """
    text = html_to_text(
        '<img src="/static/placeholder.gif" data-src="https://cdn.nobroker.in/i/real.jpg">',
        BASE,
    )
    assert "https://cdn.nobroker.in/i/real.jpg" in text
    assert "placeholder.gif" not in text


def test_script_and_style_contents_are_dropped() -> None:
    """Otherwise a page of minified JS becomes most of what the model reads."""
    html = """
      <script>var listings=[{"rent":99999,"fake":true}];</script>
      <style>.price{color:red}</style>
      <p>2 BHK in Yelahanka, Rs. 25,000</p>
    """
    text = html_to_text(html, BASE)
    assert "Rs. 25,000" in text
    assert "99999" not in text, "a price inside a script tag is not a listing"
    assert "color:red" not in text


def test_listings_do_not_run_together() -> None:
    """Block elements break lines so one property ends before the next starts."""
    text = html_to_text("<li>Flat A Rs. 10,000</li><li>Flat B Rs. 20,000</li>", BASE)
    assert "\n" in text
    assert "10,000Flat B" not in text


def test_entities_are_decoded() -> None:
    assert "₹25,000" in html_to_text("<p>&#8377;25,000</p>", BASE)


def test_malformed_markup_does_not_raise() -> None:
    """Real pages are broken in ways no parser should die on."""
    assert isinstance(html_to_text("<div><p>2 BHK<span>unclosed", BASE), str)


# --------------------------------------------------------------------------
# deciding whether the browser is still needed
# --------------------------------------------------------------------------


def _page(text: str) -> HttpPage:
    return HttpPage(url=BASE, status=200, text=text)


def test_a_page_with_prices_is_accepted() -> None:
    assert _page("2 BHK in Yelahanka. Rs. 25,000 per month. " + "x" * 700).looks_like_listings


def test_a_rupee_symbol_counts_as_a_price() -> None:
    assert _page("2 BHK ₹25,000 " + "x" * 700).looks_like_listings


def test_a_client_rendered_shell_is_rejected() -> None:
    """Navigation and no prices: the signal to start a browser after all.

    Accepting this would hand the extractor an empty page and mark the site
    done — turning "we should have rendered it" into "this portal had nothing",
    which is worse because it looks like an answer.
    """
    assert not _page("Home About Login Sign up Contact " + "x" * 700).looks_like_listings


def test_a_near_empty_response_is_rejected() -> None:
    assert not _page("Loading… ₹").looks_like_listings
