"""The site registry, and honest expectations for each one.

``contact_gated`` is the field that matters. NoBroker, 99acres, MagicBricks and
Housing all keep the owner's phone number behind a login and usually an OTP, and
they block automated readers. A crawl of those sites can find *listings* — rent,
locality, photos — but generally not a *number to dial*, which is the thing this
product needs.

That is recorded here rather than discovered on demo day. Where the pipeline
works end-to-end is the long tail: a builder's own site, a classifieds page, a
society noticeboard, or a URL the customer pastes herself.
"""

from __future__ import annotations

from dataclasses import dataclass
from urllib.parse import quote_plus

from app.models import SearchCriteria, TargetSite


@dataclass(frozen=True, slots=True)
class SiteSpec:
    """A known portal and how to build a search URL for it."""

    key: str
    name: str
    base: str
    #: ``{q}`` is the URL-encoded locality or city.
    search_path: str
    contact_gated: bool
    note: str

    def search_url(self, query: str) -> str:
        return self.base + self.search_path.format(q=quote_plus(query))


SITES: dict[str, SiteSpec] = {
    "nobroker": SiteSpec(
        key="nobroker",
        name="NoBroker",
        base="https://www.nobroker.in",
        search_path="/property/rent/search?searchParam={q}",
        contact_gated=True,
        note="Owner numbers require sign-in and an OTP; expect listings without contacts.",
    ),
    "99acres": SiteSpec(
        key="99acres",
        name="99acres",
        base="https://www.99acres.com",
        search_path="/search/property/rent/{q}?city=&preference=R",
        contact_gated=True,
        note="Contact details behind a login wall; heavy bot protection.",
    ),
    "magicbricks": SiteSpec(
        key="magicbricks",
        name="MagicBricks",
        base="https://www.magicbricks.com",
        search_path="/property-for-rent/residential-real-estate?proptype=&cityName={q}",
        contact_gated=True,
        note="Numbers revealed only after sign-in.",
    ),
    "housing": SiteSpec(
        key="housing",
        name="Housing.com",
        base="https://housing.com",
        search_path="/in/buy/search?q={q}",
        contact_gated=True,
        note="Contact gated; listing data usually readable.",
    ),
    "olx": SiteSpec(
        key="olx",
        name="OLX",
        base="https://www.olx.in",
        search_path="/items/q-{q}",
        contact_gated=True,
        note="Numbers hidden behind an in-app chat.",
    ),
}

DEFAULT_SITE_KEYS = ["nobroker", "99acres", "magicbricks"]


def resolve_targets(
    requested: list[str], criteria: SearchCriteria, *, max_sites: int = 5
) -> list[TargetSite]:
    """Turn user input into at most five concrete URLs to visit.

    Accepts portal keys (``"nobroker"``), full URLs the customer pasted, or
    nothing at all — in which case a small default set is used.

    A pasted URL is assumed *not* contact-gated: the customer chose it, most
    likely because she can already see a number on it.
    """
    chosen = requested or DEFAULT_SITE_KEYS
    query = _query_for(criteria)
    targets: list[TargetSite] = []
    seen: set[str] = set()

    for item in chosen:
        entry = item.strip()
        if not entry:
            continue

        if entry.startswith(("http://", "https://")):
            if entry in seen:
                continue
            seen.add(entry)
            targets.append(
                TargetSite(name=_host_of(entry), url=entry, contact_gated=False)  # type: ignore[arg-type]
            )
        else:
            spec = SITES.get(entry.lower())
            if spec is None:
                continue
            url = spec.search_url(query)
            if url in seen:
                continue
            seen.add(url)
            targets.append(
                TargetSite(name=spec.name, url=url, contact_gated=spec.contact_gated)  # type: ignore[arg-type]
            )

        if len(targets) >= max_sites:
            break

    return targets


def _query_for(criteria: SearchCriteria) -> str:
    """The locality or city string to search a portal for."""
    if criteria.localities:
        return criteria.localities[0]
    if criteria.city:
        return criteria.city
    return "bangalore"


def _host_of(url: str) -> str:
    from urllib.parse import urlparse

    return urlparse(url).netloc or url
