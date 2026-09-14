"""Portal listings survive an AI extractor that cannot run.

The live failure: a search fetched NoBroker and RealEstateIndia, the model then
failed on both, and the customer got only Khoj's own listings — no portal links
— although every link, rent and photograph was sitting in the fetched markup.
"""

from __future__ import annotations

import pytest

from app import pipeline
from app import repositories as repo
from app.models import ListingSourceStatus, SearchCriteria, SearchSession, SessionStatus, TargetSite
from app.scraping.crawler import PageResult
from app.scraping.html_listings import listings_from_html, parse

ID_A = "8a9f9e8286f4a6bc0186f4b0c1d2e3f4"
ID_B = "8a9f9e8286f4a6bc0186f4b0c1d2e3f5"

#: Trimmed to the shape that matters: detail links and photographs emitted near
#: each other but not nested, the way the portal's React markup delivers them.
NOBROKER_PAGE = f"""
<div class="card"><a href="/property/2-bhk-apartment-for-rent-in-koramangala-bangalore-for-rs-30000/{ID_A}/detail">2 BHK</a>
<span>Rs 30,000</span><span>1,150 sqft</span></div>
<img src="https://images.nobroker.in/images/{ID_A}/{ID_A}_photo.jpg">
<div class="card"><a href="/property/3-bhk-apartment-for-rent-in-koramangala-bangalore-for-rs-52000/{ID_B}/detail">3 BHK</a></div>
<img src="https://images.nobroker.in/images/{ID_B}/{ID_B}_photo.jpg">
<a href="/property/2-bhk-apartment-for-lease-in-koramangala-for-rs-2500000/{ID_A}9/detail">lease</a>
<img src="https://assets.nobroker.in/static/logo.png">
"""

CRITERIA = SearchCriteria(city="Bengaluru", localities=["Koramangala"], bedrooms=2)


def test_links_rent_and_photo_come_from_the_markup() -> None:
    [flat] = parse(NOBROKER_PAGE, "https://www.nobroker.in/2bhk-flats-for-rent-in-koramangala_bangalore", 2)

    assert flat.link == (
        f"https://www.nobroker.in/property/2-bhk-apartment-for-rent-in-koramangala-bangalore-for-rs-30000/{ID_A}/detail"
    )
    assert flat.rent == 30000
    assert flat.photo == f"https://images.nobroker.in/images/{ID_A}/{ID_A}_photo.jpg"


def test_the_wrong_bedroom_count_and_leases_are_left_out() -> None:
    links = [x.link for x in parse(NOBROKER_PAGE, "https://www.nobroker.in/", 2)]
    assert not any("3-bhk" in link for link in links)
    assert not any("for-lease" in link for link in links)


def test_no_bedroom_count_asked_keeps_every_rental() -> None:
    assert len(parse(NOBROKER_PAGE, "https://www.nobroker.in/", None)) == 2


def test_they_become_real_listings() -> None:
    [listing] = listings_from_html(
        NOBROKER_PAGE,
        base_url="https://www.nobroker.in/",
        source_site="NoBroker",
        session_id="ses_1",
        criteria=CRITERIA,
    )
    assert listing.source_site == "NoBroker"
    assert str(listing.url).startswith("https://www.nobroker.in/property/")
    assert listing.locality == "Koramangala"
    assert listing.rent == 30000


def test_an_empty_page_is_nothing_rather_than_an_error() -> None:
    assert listings_from_html(
        "", base_url="https://x.test/", source_site="NoBroker", session_id="s", criteria=CRITERIA
    ) == []


@pytest.mark.usefixtures("mongo_db")
async def test_a_failed_extractor_still_returns_linked_portal_listings(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The live case, through run_search."""
    session = SearchSession(
        id="ses_quota",
        customer_id="usr_1",
        prompt="2BHK in Koramangala",
        criteria=CRITERIA,
        target_sites=[TargetSite(name="NoBroker", url="https://www.nobroker.in/koramangala")],
        include_native=True,
    )
    await repo.create_session(session)

    async def fake_crawl(sites):
        return [
            PageResult(
                site=s,
                status=ListingSourceStatus.CONTACT_GATED,
                text="2 BHK Rs 30,000 " * 60,
                html=NOBROKER_PAGE,
                final_url="https://www.nobroker.in/2bhk-flats-for-rent-in-koramangala_bangalore",
            )
            for s in sites
        ]

    async def quota_exhausted(**_kwargs):
        raise RuntimeError("429 RESOURCE_EXHAUSTED")

    monkeypatch.setattr(pipeline, "crawl", fake_crawl)
    monkeypatch.setattr(pipeline, "extract_listings", quota_exhausted)

    await pipeline.run_search(session)

    stored = await repo.get_session("ses_quota")
    assert stored.status is SessionStatus.RANKED
    found = await repo.listings_for_session("ses_quota")
    portal = [x for x in found if x.source_site == "NoBroker"]
    assert len(portal) == 1, "the portal's listing should survive the extractor failing"
    assert portal[0].url is not None, "and keep its link to the portal"
    assert portal[0].image_url is not None
    assert "could not be read" not in (stored.error or "")
