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

import logging
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


log = logging.getLogger(__name__)

SITES: dict[str, SiteSpec] = {
    "nobroker": SiteSpec(
        key="nobroker",
        name="NoBroker",
        base="https://www.nobroker.in",
        search_path="/property/rent/search?searchParam={q}",
        contact_gated=True,
        note=(
            "Serves only a page shell to automated readers; listings never render. Paste a listing URL instead."
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
}

#: MagicBricks first because it is the only one of the five that actually
#: renders its listings to an automated reader. Measured 2026-09-06: it returns
#: ~23k characters and dozens of rupee figures, while NoBroker serves a shell,
#: 99acres answers 403 and Housing answers 406.
#:
#: The others stay selectable — a customer who pastes a specific listing URL
#: from them still gets it read — but defaulting to sites that cannot be read
#: makes an empty result look like a broken product.
DEFAULT_SITE_KEYS = ["magicbricks"]


#: Spellings that mean a known portal but are not its key.
#:
#: The lookup used to be an exact dict hit on the lowercased input, so
#: "nobroker" worked and "NoBroker.in", "no broker" and "www.nobroker.in" all
#: failed with "none of those sites could be resolved" — which reads as a broken
#: product rather than a typo. Anything a person would reasonably type for a
#: site we support should reach that site.
SITE_ALIASES: dict[str, str] = {
    "no broker": "nobroker",
    "nobrokerin": "nobroker",
    "nb": "nobroker",
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

    # A bare domain or a pasted host: strip scheme, www and path.
    entry = entry.removeprefix("https://").removeprefix("http://")
    entry = entry.removeprefix("www.")
    entry = entry.split("/", 1)[0].strip()

    if entry in SITES:
        return entry

    # Drop the TLD: "nobroker.in" -> "nobroker", "housing.com" -> "housing".
    stem = entry.split(".", 1)[0].strip()
    if stem in SITES:
        return stem

    for candidate in (entry, stem):
        if candidate in SITE_ALIASES:
            return SITE_ALIASES[candidate]

    # Last resort: squeeze out spaces, dots and hyphens and try again, so
    # "magic bricks" and "magic-bricks" both land on "magicbricks".
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
