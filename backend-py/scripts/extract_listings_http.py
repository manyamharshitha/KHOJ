#!/usr/bin/env python
"""Pull rental listings — rent, area, direct link, photograph — over plain HTTP.

    python scripts/extract_listings_http.py yelahanka bangalore
    python scripts/extract_listings_http.py yelahanka bangalore --json

No headless browser, no automation framework, no LLM, nothing metered. A GET
with an ordinary User-Agent, then the HTML is read directly. About a second and
a few megabytes per portal.

Why it does not parse the DOM
----------------------------
The obvious approach — find each listing's <a> card and read the <img> inside
it — does not survive these pages. They are React applications: the anchor and
the photograph frequently are not nested, the markup is assembled from
fragments, and a card-shaped container often does not exist in the delivered
HTML at all. A first version built that way returned nothing from a page
carrying twenty-five perfectly good listings.

What is reliable is position. A listing's link and its photograph are emitted
close together because they are rendered from the same object, so each detail
link is paired with the nearest image URL by byte offset. Where a portal puts
the property id in both — NoBroker does — that exact join is preferred, since
proximity can be wrong at a boundary and an id cannot.

99acres answers 403 and Housing.com answers 406. They are left out: that is
their answer, and it does not change by being asked differently.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import re
import sys
from dataclasses import asdict, dataclass
from urllib.parse import urljoin

import httpx

UA = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)
HEADERS = {
    "User-Agent": UA,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-IN,en;q=0.9",
}

#: Where to look, most specific first.
#:
#: Each portal keeps a locality page for the places it has enough stock to fill
#: one, and answers 404 for everywhere else. Yelahanka has a page; Andheri does
#: not, and neither does Adyar or Kothrud — which made a script written against
#: one Bangalore suburb look correct and work almost nowhere.
#:
#: So the locality URL is tried first and the city-wide page is the fallback,
#: with the locality filtered back out of the results afterwards. A city page
#: carrying the right flat among a thousand others is worth far more than a 404.
PORTALS: dict[str, list[str]] = {
    "nobroker": [
        # The underscore between locality and city is load-bearing: the hyphen
        # form only redirects, and the city alone answers 410.
        "https://www.nobroker.in/2bhk-flats-for-rent-in-{loc}_{city}",
        "https://www.nobroker.in/2bhk-flats-for-rent-in-{city}",
    ],
    "realestateindia": [
        "https://www.realestateindia.com/{city}-property"
        "/2-bhk-flats-apartments-for-rent-in-{loc}-ffid.htm",
        "https://www.realestateindia.com/{city}-property"
        "/2-bhk-flats-apartments-for-rent-ffid.htm",
    ],
    # Square Yards is deliberately absent. Its pages carry rents and sizes in
    # the HTML but not one listing link — those are written by script after the
    # page loads, so a plain GET finds zero. Measured: 110KB of markup, 55
    # prices, 279 images, and no per-listing href at all.
    #
    # A listing with no link cannot be opened, cannot be checked, and cannot be
    # told apart from the one below it, so there is nothing here worth keeping.
    # Reading it needs a browser, which is the thing this script exists to
    # avoid.
}

#: Cities a portal does not cover at all.
#:
#: NoBroker answers 410 Gone for every Kolkata URL, locality or city — it
#: operates in about eight metros and Kolkata is not one of them. Worth saying
#: out loud rather than reporting as a failure, because "this portal does not
#: cover your city" and "something went wrong" call for different responses
#: from whoever is reading.
GONE = 410

#: A link to one property's own page.
DETAIL = re.compile(r'["\'](/?(?:[^"\']*?)/(?:property|property-detail)/[^"\']{10,200}?)["\']')

#: A photograph, as opposed to a logo, sprite, icon or tracking pixel.
IMAGE = re.compile(r'["\'](https?://[^"\']+?\.(?:jpe?g|png|webp)(?:\?[^"\']*)?)["\']')
#: A portal's own "we have no photograph" graphic is not a photograph. Showing
#: one as if it were the property is worse than showing nothing, because the
#: customer reads a grey box as the flat rather than as an absence.
NOT_A_PHOTO = re.compile(
    r"logo|sprite|icon|placeholder|blank|pixel|avatar|banner|no[-_]?image|no[-_]property",
    re.I,
)

#: NoBroker writes the rent and the property id straight into the path:
#:     /property/2-bhk-...-for-rs-25000/8a9f9e82.../detail
RENT_IN_PATH = re.compile(r"for-rs-(\d{4,9})")
ID_IN_PATH = re.compile(r"/([0-9a-f]{24,40})/")

#: RealEstateIndia writes both into the filename, digits split by hyphens:
#:     ...-yelahanka-bangalore-1031-sq-ft-16-500-1071279.htm
#: which is 1031 sq ft at Rs 16,500. Read from the URL rather than from nearby
#: markup, because the markup is where the mistakes come from.
REI_IN_PATH = re.compile(r"-(\d{3,5})-sq-ft-([\d-]{4,9}?)-\d{5,}\.htm", re.I)

#: The bedroom count, where the path states it. RealEstateIndia writes "2bkh",
#: which is a typo for BHK on their side and has to be matched as it is rather
#: than as it should be.
#: Both spellings, because the same portal uses both: "2bkh-flats-..." on one
#: URL and "3-bedrooms-in-..." on the next. Matching only the first let a
#: three-bedroom through a two-bedroom search.
BEDROOMS_IN_PATH = re.compile(r"\b(\d)[\s-]?(?:bhk|bkh|bedrooms?)\b", re.I)

#: RealEstateIndia names its photographs after the property id that ends the
#: URL: .../rent/2-bedrooms-in-yelahanka-...-518431.htm is pictured by
#: .../prop_images/wh2/885835/518431_1.jpg. An exact join, where proximity had
#: been putting one property's photograph on its neighbour.
REI_ID_IN_PATH = re.compile(r"-(\d{5,9})\.htm", re.I)
REI_ID_IN_IMAGE = re.compile(r"/(\d{5,9})_\d+[-.]", re.I)

#: A lease is a lump sum, not a monthly rent.
#:
#: NoBroker lists these alongside rentals as "for-lease ... for-rs-2500000",
#: and read as rent it becomes a twenty-five lakh a month flat sorted to the
#: bottom of every list. It is a different kind of transaction and does not
#: belong in a rental search at all.
IS_A_LEASE = re.compile(r"for-lease", re.I)

#: Prices and sizes in the surrounding markup, used only when the URL has none.
RENT_NEARBY = re.compile(r"(?:₹|Rs\.?\s?|INR\s?)\s?([\d,]{4,12})")
AREA_NEARBY = re.compile(r"([\d,]{3,7})\s*(?:sq\.?\s?ft|sqft|square\s?feet)", re.I)

#: How far either side of a link to look, when the URL does not say.
#:
#: Deliberately tight. At 3000 this reached past the card and collected a
#: filter widget's default price, which put the same rent and the same area on
#: three different properties — a number that is confidently wrong and belongs
#: to some other flat entirely. A field left empty is recoverable; a field
#: filled from the neighbours is not, because nothing downstream can tell.
WINDOW = 600


@dataclass
class Listing:
    portal: str
    rent: int | None
    area_sqft: int | None
    link: str
    photo: str | None


def slug(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")


def _int(text: str) -> int | None:
    try:
        value = int(text.replace(",", ""))
    except ValueError:
        return None
    # A rent under a thousand is a page number or a floor; over five crore is a
    # sale price that wandered in from a "properties for sale" strip.
    return value if 1_000 <= value <= 50_000_000 else None


def parse(html: str, base: str, portal: str, bedrooms: int = 2) -> list[Listing]:
    """Every listing on the page, keyed by its own URL."""
    images = [
        (m.start(), m.group(1))
        for m in IMAGE.finditer(html)
        if not NOT_A_PHOTO.search(m.group(1))
    ]
    # Two exact indexes, one per portal's naming scheme. Both beat proximity,
    # which cannot tell a card's own photograph from the one beside it.
    images_by_id: dict[str, str] = {}
    for _, url in images:
        found = ID_IN_PATH.search(url)
        if found:
            images_by_id.setdefault(found.group(1), url)
        rei = REI_ID_IN_IMAGE.search(url)
        if rei:
            images_by_id.setdefault(rei.group(1), url)

    found: dict[str, Listing] = {}

    for match in DETAIL.finditer(html):
        href = match.group(1)

        # A 2BHK search page carries links to 1BHK and 3BHK properties too, in
        # "similar" strips and the sidebar. Where the path names the count,
        # honour it — a 1BHK in a list of 2BHKs is not a near miss, it is the
        # wrong flat.
        beds = BEDROOMS_IN_PATH.search(href)
        if beds and int(beds.group(1)) != bedrooms:
            continue

        if IS_A_LEASE.search(href):
            continue

        link = urljoin(base, href)
        at = match.start()
        near = html[max(0, at - WINDOW) : at + WINDOW]

        # The URL first, always. It belongs to this property and cannot be
        # confused with its neighbour's; the surrounding markup can.
        rent = area = None

        rei = REI_IN_PATH.search(href)
        if rei:
            area = _int(rei.group(1))
            rent = _int(rei.group(2).replace("-", ""))

        if rent is None:
            in_path = RENT_IN_PATH.search(href)
            rent = _int(in_path.group(1)) if in_path else None
        if rent is None:
            nearby = RENT_NEARBY.search(near)
            rent = _int(nearby.group(1)) if nearby else None

        if area is None:
            area_match = AREA_NEARBY.search(near)
            area = _int(area_match.group(1)) if area_match else None
        if area is not None and not 100 <= area <= 20_000:
            area = None  # a price that happened to sit in front of "sq ft"

        # The property id, where the portal gives one, is an exact join. Falling
        # back to proximity only when it does not.
        # Where the portal names its photographs after the property, that join
        # is authoritative — and so is a miss. A listing whose id matches no
        # image simply has no photograph on this page, and falling back to the
        # nearest one would hand it a picture of the flat next to it.
        #
        # That is not a cosmetic error. It is the one field the customer trusts
        # without checking: she will not cross-examine a photograph the way she
        # re-reads a rent, and she travels across the city on the strength of
        # it. Proximity is only used where there is no id to go on at all.
        photo = None
        id_match = ID_IN_PATH.search(href) or REI_ID_IN_PATH.search(href)
        if id_match:
            photo = images_by_id.get(id_match.group(1))
        elif images:
            candidates = [(abs(pos - at), url) for pos, url in images if abs(pos - at) < WINDOW]
            if candidates:
                photo = min(candidates)[1]

        listing = Listing(portal=portal, rent=rent, area_sqft=area, link=link, photo=photo)

        # Keyed on the URL: portals repeat a property in carousels and
        # "similar properties" strips, and the link is what makes it the same
        # property rather than a different flat at the same rent.
        previous = found.get(link)
        if previous is None or _filled(listing) > _filled(previous):
            found[link] = listing

    return [x for x in found.values() if x.rent or x.photo]


def _filled(listing: Listing) -> int:
    return sum(1 for v in (listing.rent, listing.area_sqft, listing.photo) if v)


async def scrape(portal: str, locality: str, city: str, bedrooms: int = 2) -> list[Listing]:
    """Try each URL for this portal until one answers with listings."""
    candidates = PORTALS[portal]
    loc, cty = slug(locality), slug(city)

    async with httpx.AsyncClient(
        follow_redirects=True, timeout=30.0, headers=HEADERS
    ) as client:
        for index, template in enumerate(candidates):
            url = template.format(loc=loc, city=cty)
            try:
                response = await client.get(url)
            except httpx.HTTPError as exc:
                print(f"  {portal}: no answer ({type(exc).__name__})", file=sys.stderr)
                return []

            if response.status_code == GONE:
                print(f"  {portal}: does not cover {city}", file=sys.stderr)
                return []
            if response.status_code >= 400:
                continue  # try the next, broader URL

            listings = parse(response.text, str(response.url), portal, bedrooms)

            # Past the first candidate this is a city-wide page, so the
            # locality has to be applied here instead of by the URL. Matching
            # on the link, which carries the address as a slug — the visible
            # text does not survive into the fields being kept.
            if index > 0:
                narrowed = [x for x in listings if loc in slug(x.link)]
                if narrowed:
                    print(
                        f"  {portal}: no page for {locality}, filtered "
                        f"{len(narrowed)} of {len(listings)} from the {city} page",
                        file=sys.stderr,
                    )
                    return narrowed
                # The city page had nothing in this locality. Saying so beats
                # returning a thousand flats from the wrong side of the city.
                print(
                    f"  {portal}: nothing in {locality} on the {city} page",
                    file=sys.stderr,
                )
                return []

            if listings:
                return listings

    return []


async def main() -> int:
    ap = argparse.ArgumentParser(description="Rental listings over plain HTTP.")
    ap.add_argument("locality", help="e.g. yelahanka")
    ap.add_argument("city", nargs="?", default="bangalore")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--portal", choices=sorted(PORTALS), action="append")
    args = ap.parse_args()

    portals = args.portal or sorted(PORTALS)
    groups = await asyncio.gather(*(scrape(p, args.locality, args.city) for p in portals))
    listings = [x for group in groups for x in group]
    listings.sort(key=lambda x: (x.rent is None, x.rent or 0))

    if args.json:
        print(json.dumps([asdict(x) for x in listings], indent=2))
        return 0

    if not listings:
        print("No listings found.")
        return 1

    for x in listings:
        rent = f"Rs {x.rent:,}" if x.rent else "—"
        area = f"{x.area_sqft:,} sqft" if x.area_sqft else "—"
        print(f"\n  {rent:>12}   {area:<12} [{x.portal}]")
        print(f"    link  {x.link}")
        print(f"    photo {x.photo or '—'}")

    with_photo = sum(1 for x in listings if x.photo)
    print(f"\n\n  {len(listings)} listings, {with_photo} with photographs.")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
