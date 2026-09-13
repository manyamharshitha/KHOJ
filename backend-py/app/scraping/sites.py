
from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from urllib.parse import quote_plus

from app.models import SearchCriteria, TargetSite


@dataclass(frozen=True, slots=True)
class SiteSpec:
    """A known portal and how to build a search URL for it."""

    key: str
    name: str
    base: str
    search_path: str
    contact_gated: bool
    note: str
    path_slug: bool = False

    def search_url(self, query: str, *, locality: str = "", city: str = "") -> str:
        """The page to fetch for this search.

        Three placeholders, because one was not enough and the shortfall was
        silent. ``{q}`` is the whole query as before; ``{locality}`` and
        ``{city}`` are the parts, for the portals that address them separately.

        NoBroker is the case that forced it: its rental pages are keyed
        ``<locality>_<city>``, and a URL carrying only the city answers 410
        Gone. The crawler recorded a dead page and the search came back empty,
        which reads as a broken crawler rather than a malformed URL. Measured
        on 2026-09-11:

            /2bhk-flats-for-rent-in-yelahanka_bangalore   200
            /2bhk-flats-for-rent-in-bangalore             410

        Note the underscore between the two, which is why they are separate
        placeholders rather than one slug — the separator differs per portal,
        and RealEstateIndia puts the city in a different path segment entirely.
        """
        # Translated to whatever this portal calls the place, not to whatever
        # it is called now.
        city = portal_city(city)
        query = portal_city(query)

        if self.path_slug:
            return self.base + self.search_path.format(
                q=_slug(query), locality=_slug(locality), city=_slug(city)
            )
        return self.base + self.search_path.format(
            q=quote_plus(query), locality=quote_plus(locality), city=quote_plus(city)
        )


#: The name a portal files a city under, which is not always its current name.
#:
#: India renamed a lot of cities and the property portals largely did not follow.
#: NoBroker and RealEstateIndia both answer 410 Gone for "bengaluru" and 200 for
#: "bangalore" — measured on 2026-09-13:
#:
#:     /2bhk-flats-for-rent-in-koramangala_bengaluru   410
#:     /2bhk-flats-for-rent-in-koramangala_bangalore   200
#:
#: The model writes the modern name into the criteria, correctly, and every URL
#: built from it was dead. The search then reported "nothing matched" about
#: pages it had never successfully opened, which is the worst kind of wrong: it
#: looks like an answer.
#:
#: Mapped rather than corrected at the source, because the customer's city is
#: hers to name. This is only how a particular portal spells it.
_PORTAL_CITY_NAMES = {
    "bengaluru": "bangalore",
    "mumbai": "mumbai",  # Bombay is long gone from these URLs
    "chennai": "chennai",
    "kolkata": "kolkata",
    "puducherry": "pondicherry",
    "thiruvananthapuram": "trivandrum",
    "kochi": "cochin",
    "vadodara": "baroda",
    "prayagraj": "allahabad",
    "varanasi": "varanasi",
    "gurugram": "gurgaon",
    "mysuru": "mysore",
    "mangaluru": "mangalore",
    "belagavi": "belgaum",
    "hubballi": "hubli",
    "shivamogga": "shimoga",
    "tiruchirappalli": "trichy",
    "thoothukudi": "tuticorin",
}


def portal_city(value: str) -> str:
    """The city as the portals spell it."""
    return _PORTAL_CITY_NAMES.get(value.strip().lower(), value)


def _slug(value: str) -> str:
    """Lowercase, hyphen-separated, safe to drop into a path segment."""
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")


log = logging.getLogger(__name__)

SITES: dict[str, SiteSpec] = {
    "nobroker": SiteSpec(
        key="nobroker",
        name="NoBroker",
        # The locality-slug page, not the query endpoint.
        #
        # `/property/rent/search?searchParam=` returned a shell whose listings
        # were drawn by script, which is what the old note here recorded. The
        # slug form serves the listings in the HTML, each with its own
        # /property/<slug>/<id>/detail link — twenty-five of them for Yelahanka
        # on 2026-09-11.
        base="https://www.nobroker.in",
        # Underscore between locality and city, and it is load-bearing: the
        # hyphen form only redirects and the city alone is 410.
        search_path="/2bhk-flats-for-rent-in-{locality}_{city}",
        path_slug=True,
        contact_gated=True,
        note=(
            "Listings and their links are readable. Phone numbers sit behind a "
            "login, so Khoj cannot call these for you."
        ),
    ),
    "realestateindia": SiteSpec(
        key="realestateindia",
        name="RealEstateIndia",
        base="https://www.realestateindia.com",
        search_path="/{city}-property/2-bhk-flats-apartments-for-rent-in-{locality}-ffid.htm",
        path_slug=True,
        contact_gated=True,
        note=(
            "Listings and their links are readable. Phone numbers sit behind a "
            "login, so Khoj cannot call these for you."
        ),
    ),
    "squareyards": SiteSpec(
        key="squareyards",
        name="Square Yards",
        base="https://www.squareyards.com",
        search_path="/rent/2-bhk-for-rent-in-{q}",
        path_slug=True,
        contact_gated=True,
        note=(
            "Rents and sizes are readable, but each listing's own link is drawn "
            "by script and is not in the HTML, so results here carry no direct link."
        ),
    ),
    "99acres": SiteSpec(
        key="99acres",
        name="99acres",
        base="https://www.99acres.com",
        search_path="/search/property/rent/{q}?city=&preference=R",
        contact_gated=True,
        note=(
            "Refuses automated readers outright (HTTP 403). Paste a listing URL instead."
        ),
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
        note=(
            "Refuses automated readers outright (HTTP 406). Paste a listing URL instead."
        ),
    ),
    "olx": SiteSpec(
        key="olx",
        name="OLX",
        base="https://www.olx.in",
        search_path="/items/q-{q}",
        contact_gated=True,
        note="Numbers hidden behind an in-app chat.",
    ),
    "zolo": SiteSpec(
        key="zolo",
        name="Zolo",
        base="https://zolostays.com",
        search_path="/pgs-in-{q}",
        contact_gated=False,
        note="Managed co-living operator — one central number, shown on every city page, no login.",
        path_slug=True,
    ),
    "colive": SiteSpec(
        key="colive",
        name="Colive",
        base="https://www.colive.com",
        search_path="/pg-in-{q}",
        contact_gated=False,
        note="Managed co-living operator — one central number, shown on every city page, no login.",
        path_slug=True,
    ),
    "stanzaliving": SiteSpec(
        key="stanzaliving",
        name="Stanza Living",
        base="https://www.stanzaliving.com",
        search_path="/pg-hostel-{q}",
        contact_gated=True,
        note="No number on the page — only a 'request a callback' form.",
        path_slug=True,
    ),
}


#: What a search reads when the customer names no sources.
#:
#: The portals come first, and that is a correction rather than a preference.
#: This was `["zolo", "colive"]` — two managed co-living operators — on the
#: reasoning that they publish a callable number and the portals do not. The
#: effect was that every default search returned nothing: Zolo needs a browser
#: and times out, Colive needs one too, and neither lists ordinary flats. A
#: customer looking for a 2BHK in Koramangala was shown zero results while
#: NoBroker had twenty-five of them on a page Khoj can read in a second.
#:
#: Finding the flat is the service. Ringing it is what happens next, and a
#: listing with no published number is still a listing she wants to see — she
#: can call it herself. The gated portals therefore lead, and the operators
#: stay because their numbers are the ones Khoj can actually dial.
DEFAULT_SITE_KEYS = ["nobroker", "realestateindia", "zolo", "colive"]
SITE_ALIASES: dict[str, str] = {
    "no broker": "nobroker",
    "nobrokerin": "nobroker",
    "nb": "nobroker",
    "realestateindiacom": "realestateindia",
    "realestate": "realestateindia",
    "rei": "realestateindia",
    "squareyardscom": "squareyards",
    "square": "squareyards",
    "sy": "squareyards",
    "99 acres": "99acres",
    "99acrescom": "99acres",
    "ninetynineacres": "99acres",
    "acres99": "99acres",
    "magic bricks": "magicbricks",
    "magicbrickscom": "magicbricks",
    "mb": "magicbricks",
    "housingcom": "housing",
    "housing com": "housing",
    "olxin": "olx",
    "olx india": "olx",
    "zolostays": "zolo",
    "zolo stays": "zolo",
    "co live": "colive",
    "stanza living": "stanzaliving",
    "stanza": "stanzaliving",
}


def normalise_site_key(raw: str) -> str | None:
    """The portal key for whatever the customer typed, or ``None``.

    Handles case, surrounding whitespace, internal spaces, a leading ``www.``,
    a trailing TLD, and the aliases above. Returns ``None`` only when the input
    genuinely does not name a portal we know.
    """
    entry = (raw or "").strip().lower()
    if not entry:
        return None
    entry = entry.removeprefix("https://").removeprefix("http://")
    entry = entry.removeprefix("www.")
    entry = entry.split("/", 1)[0].strip()

    if entry in SITES:
        return entry
    stem = entry.split(".", 1)[0].strip()
    if stem in SITES:
        return stem

    for candidate in (entry, stem):
        if candidate in SITE_ALIASES:
            return SITE_ALIASES[candidate]
    squeezed = "".join(ch for ch in entry if ch.isalnum())
    if squeezed in SITES:
        return squeezed
    return SITE_ALIASES.get(squeezed)



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
            key = normalise_site_key(entry)
            spec = SITES.get(key) if key else None
            if spec is None:
                log.info("sites: %r does not name a portal we know", entry)
                continue
            url = spec.search_url(
                query,
                locality=criteria.localities[0] if criteria.localities else "",
                city=criteria.city or "",
            )
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
    """The string to search a portal for. City first, deliberately.

    Portals index by city: MagicBricks answers "Oops... something is missing"
    for ``cityName=Kondapur`` and returns thousands of listings for
    ``cityName=Hyderabad``. Preferring the locality produced a search that
    always came back empty, which read as a broken crawler rather than a wrong
    query.

    Narrowing to the locality still happens — ``filter_hard_constraints`` does
    it after extraction, against the listing's own address rather than against
    a URL the portal may not understand.
    """
    if criteria.city:
        return criteria.city
    if criteria.localities:
        return criteria.localities[0]
    return "Hyderabad"


def _host_of(url: str) -> str:
    from urllib.parse import urlparse

    return urlparse(url).netloc or url
