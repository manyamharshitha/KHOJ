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
    def test_defaults_to_the_two_sites_that_are_not_contact_gated(self) -> None:
        assert DEFAULT_SITE_KEYS == ["zolo", "colive"]
        assert all(not SITES[key].contact_gated for key in DEFAULT_SITE_KEYS)


class TestAliases:
    def test_zolostays_resolves_to_zolo(self) -> None:
        assert normalise_site_key("ZoloStays") == "zolo"

    def test_co_live_resolves_to_colive(self) -> None:
        assert normalise_site_key("co live") == "colive"

    def test_stanza_resolves_to_stanzaliving(self) -> None:
        assert normalise_site_key("stanza") == "stanzaliving"


class TestResolveTargets:
    def test_default_targets_are_not_contact_gated(self) -> None:
        targets = resolve_targets([], SearchCriteria(city="Hyderabad"))
        assert [t.name for t in targets] == ["Zolo", "Colive"]
        assert all(not t.contact_gated for t in targets)
