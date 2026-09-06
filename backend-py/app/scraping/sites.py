
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

    def search_url(self, query: str) -> str:
        if self.path_slug:
            slug = re.sub(r"[^a-z0-9]+", "-", query.lower()).strip("-")
            return self.base + self.search_path.format(q=slug)
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


DEFAULT_SITE_KEYS = ["zolo", "colive"]
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
