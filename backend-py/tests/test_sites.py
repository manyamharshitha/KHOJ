from __future__ import annotations

from app.models import SearchCriteria
from app.scraping.sites import (
    DEFAULT_SITE_KEYS,
    SITES,
    normalise_site_key,
    resolve_targets,
)


class TestPathSlugSites:
    def test_zolo_url_is_a_lowercase_hyphenated_city_slug(self) -> None:
        assert SITES["zolo"].search_url("New Delhi") == "https://zolostays.com/pgs-in-new-delhi"

    def test_colive_url_is_a_lowercase_hyphenated_city_slug(self) -> None:
        assert SITES["colive"].search_url("Hyderabad") == "https://www.colive.com/pg-in-hyderabad"

    def test_existing_sites_still_use_quote_plus(self) -> None:
        assert SITES["magicbricks"].search_url("New Delhi").endswith("cityName=New+Delhi")


class TestDefaultSiteKeys:
    def test_defaults_lead_with_the_portals_that_have_the_flats(self) -> None:
        """This used to require the defaults NOT be contact-gated.

        That rule sounded right — only search what Khoj can ring — and made
        every default search return nothing. Zolo and Colive are co-living
        operators; they list no ordinary flats and both need a browser, so a
        customer looking for a 2BHK in Koramangala saw zero results while
        NoBroker had twenty-five on a page Khoj reads in a second.

        Finding the flat is the service. Ringing it is the next step, and a
        listing with no published number is still one she wants to see.
        """
        assert DEFAULT_SITE_KEYS[:2] == ["nobroker", "realestateindia"]
        assert "zolo" in DEFAULT_SITE_KEYS, "the operators still supply callable numbers"

    def test_every_default_is_a_site_we_know_how_to_reach(self) -> None:
        """A key with no SiteSpec is silently dropped by resolve_targets."""
        for key in DEFAULT_SITE_KEYS:
            assert key in SITES, key

    def test_no_default_is_a_host_that_refuses_automated_readers(self) -> None:
        """99acres answers 403 and Housing 406. Asking costs a timeout to be
        told no, and the answer will not change."""
        for key in DEFAULT_SITE_KEYS:
            assert key not in {"99acres", "magicbricks", "housing", "olx"}, key

    def test_at_least_one_default_can_actually_be_called(self) -> None:
        """Every portal gates its numbers. Without an operator in the list a
        default search can never produce a listing Khoj can ring."""
        assert any(not SITES[key].contact_gated for key in DEFAULT_SITE_KEYS)


class TestAliases:
    def test_zolostays_resolves_to_zolo(self) -> None:
        assert normalise_site_key("ZoloStays") == "zolo"

    def test_co_live_resolves_to_colive(self) -> None:
        assert normalise_site_key("co live") == "colive"

    def test_stanza_resolves_to_stanzaliving(self) -> None:
        assert normalise_site_key("stanza") == "stanzaliving"


class TestResolveTargets:
    def test_default_targets_include_the_portals_with_the_listings(self) -> None:
        targets = resolve_targets([], SearchCriteria(city="Hyderabad"))
        names = [t.name for t in targets]

        assert "NoBroker" in names and "RealEstateIndia" in names
        assert "Zolo" in names, "an operator is what makes any of it callable"

    def test_a_renamed_city_is_asked_for_by_the_name_the_portal_files_it_under(
        self,
    ) -> None:
        """India renamed its cities; the portals did not follow.

        Measured 2026-09-13 — nobroker.in answers 410 Gone for
        `koramangala_bengaluru` and 200 for `koramangala_bangalore`. Every URL
        built from the modern name was dead, and the search then reported
        "nothing matched" about pages it had never opened.
        """
        criteria = SearchCriteria(city="Bengaluru", localities=["Koramangala"])
        urls = {t.name: str(t.url) for t in resolve_targets(["nobroker"], criteria)}

        assert "bangalore" in urls["NoBroker"], urls
        assert "bengaluru" not in urls["NoBroker"], urls

    def test_a_city_the_portals_never_renamed_is_left_alone(self) -> None:
        criteria = SearchCriteria(city="Hyderabad", localities=["Kondapur"])
        urls = {t.name: str(t.url) for t in resolve_targets(["nobroker"], criteria)}

        assert "hyderabad" in urls["NoBroker"], urls
