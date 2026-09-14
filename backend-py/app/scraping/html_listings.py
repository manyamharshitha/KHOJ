"""Listings read straight from a portal page's HTML, with no model involved.

The fallback for when the AI extractor cannot run. A search that reached
NoBroker and RealEstateIndia and then hit a rate-limited or exhausted model used
to come back with nothing from either — only Khoj's own listings, none of them
linked to a portal — although both pages had been fetched and carried every
listing's link, rent and photograph in their markup.

This reads those fields from the markup directly. It gets less than the model:
no phone numbers (these portals gate them anyway), no maintenance or deposit,
no furnishing. What it does get is the part a customer uses to decide whether a
flat is worth a look — the link to the portal's own page, the rent, the size and
the photograph — and it gets them for free, in milliseconds, every time.

The approach is the one proven in scripts/extract_listings_http.py. These pages
are React applications: a listing's link and its photograph are frequently not
nested in the delivered markup, so the DOM is not walked. Each detail link is
paired with its photograph by the property id both carry, and only by proximity
where no id exists. Every value is read from the listing's own URL first,
because the URL belongs to that property and the surrounding markup can belong
to its neighbour.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from urllib.parse import urljoin

from pydantic import ValidationError

from app.ids import new_id
from app.models import Listing, SearchCriteria

log = logging.getLogger(__name__)

#: A link to one property's own page.
DETAIL = re.compile(r'["\'](/?(?:[^"\']*?)/(?:property|property-detail)/[^"\']{10,200}?)["\']')

#: A photograph, as opposed to a logo, sprite, icon or tracking pixel.
IMAGE = re.compile(r'["\'](https?://[^"\']+?\.(?:jpe?g|png|webp)(?:\?[^"\']*)?)["\']')
#: A portal's "no photograph" graphic reads as the flat, which is worse than
#: showing nothing.
NOT_A_PHOTO = re.compile(
    r"logo|sprite|icon|placeholder|blank|pixel|avatar|banner|no[-_]?image|no[-_]property",
    re.I,
)

#: NoBroker writes the rent and the property id into the path:
#:     /property/2-bhk-...-for-rs-25000/8a9f9e82.../detail
RENT_IN_PATH = re.compile(r"for-rs-(\d{4,9})")
ID_IN_PATH = re.compile(r"/([0-9a-f]{24,40})/")

#: RealEstateIndia writes size and rent into the filename, digits split by
#: hyphens: ...-1031-sq-ft-16-500-1071279.htm is 1031 sq ft at Rs 16,500.
REI_IN_PATH = re.compile(r"-(\d{3,5})-sq-ft-([\d-]{4,9}?)-\d{5,}\.htm", re.I)
#: ...and names photographs after the id that ends the URL.
REI_ID_IN_PATH = re.compile(r"-(\d{5,9})\.htm", re.I)
REI_ID_IN_IMAGE = re.compile(r"/(\d{5,9})_\d+[-.]", re.I)

#: The bedroom count where the path states it. RealEstateIndia writes "2bkh" as
#: well as "3-bedrooms", so both spellings are matched as they appear.
BEDROOMS_IN_PATH = re.compile(r"\b(\d)[\s-]?(?:bhk|bkh|bedrooms?)\b", re.I)

#: A lease is a lump sum, not a monthly rent, and does not belong in a rental search.
IS_A_LEASE = re.compile(r"for-lease", re.I)

#: Prices and sizes in the surrounding markup, used only when the URL has none.
RENT_NEARBY = re.compile(r"(?:₹|Rs\.?\s?|INR\s?)\s?([\d,]{4,12})")
AREA_NEARBY = re.compile(r"([\d,]{3,7})\s*(?:sq\.?\s?ft|sqft|square\s?feet)", re.I)

#: How far either side of a link to look when the URL does not say. Tight on
#: purpose: wider windows collected a filter widget's default price and put the
#: same rent on three different flats.
WINDOW = 600


@dataclass(slots=True)
class PageListing:
    link: str
    rent: int | None
    area_sqft: int | None
    photo: str | None
    bedrooms: int | None


def _amount(text: str) -> int | None:
    try:
        value = int(text.replace(",", ""))
    except ValueError:
        return None
    # Under a thousand is a page number or a floor; over five crore is a sale
    # price that wandered in from a "for sale" strip.
    return value if 1_000 <= value <= 50_000_000 else None


def _filled(item: PageListing) -> int:
    return sum(1 for v in (item.rent, item.area_sqft, item.photo) if v)


def parse(html: str, base: str, bedrooms: int | None = None) -> list[PageListing]:
    """Every listing on the page, one per property URL."""
    if not html:
        return []

    images = [
        (m.start(), m.group(1)) for m in IMAGE.finditer(html) if not NOT_A_PHOTO.search(m.group(1))
    ]
    images_by_id: dict[str, str] = {}
    for _, url in images:
        for pattern in (ID_IN_PATH, REI_ID_IN_IMAGE):
            found = pattern.search(url)
            if found:
                images_by_id.setdefault(found.group(1), url)

    found: dict[str, PageListing] = {}
    for match in DETAIL.finditer(html):
        href = match.group(1)

        beds_match = BEDROOMS_IN_PATH.search(href)
        beds = int(beds_match.group(1)) if beds_match else None
        # A 2BHK page links to 1BHK and 3BHK flats in "similar" strips too.
        # Where the path names the count, a different count is the wrong flat.
        if bedrooms is not None and beds is not None and beds != bedrooms:
            continue
        if IS_A_LEASE.search(href):
            continue

        link = urljoin(base, href)
        at = match.start()
        near = html[max(0, at - WINDOW) : at + WINDOW]

        rent = area = None
        rei = REI_IN_PATH.search(href)
        if rei:
            area = _amount(rei.group(1))
            rent = _amount(rei.group(2).replace("-", ""))
        if rent is None:
            in_path = RENT_IN_PATH.search(href)
            rent = _amount(in_path.group(1)) if in_path else None
        if rent is None:
            nearby = RENT_NEARBY.search(near)
            rent = _amount(nearby.group(1)) if nearby else None
        if area is None:
            area_match = AREA_NEARBY.search(near)
            area = _amount(area_match.group(1)) if area_match else None
        if area is not None and not 100 <= area <= 20_000:
            area = None

        # An id join is authoritative, and so is its miss: no matching image
        # means no photograph on this page, not the neighbour's photograph.
        photo = None
        id_match = ID_IN_PATH.search(href) or REI_ID_IN_PATH.search(href)
        if id_match:
            photo = images_by_id.get(id_match.group(1))
        elif images:
            close = [(abs(pos - at), url) for pos, url in images if abs(pos - at) < WINDOW]
            if close:
                photo = min(close)[1]

        item = PageListing(link=link, rent=rent, area_sqft=area, photo=photo, bedrooms=beds)
        previous = found.get(link)
        if previous is None or _filled(item) > _filled(previous):
            found[link] = item

    return [x for x in found.values() if x.rent or x.photo]


def listings_from_html(
    html: str,
    *,
    base_url: str,
    source_site: str,
    session_id: str,
    criteria: SearchCriteria,
    limit: int | None = None,
) -> list[Listing]:
    """Listings for one portal page, shaped like the extractor's output."""
    locality = criteria.localities[0] if criteria.localities else None
    out: list[Listing] = []
    for item in parse(html, base_url, bedrooms=criteria.bedrooms):
        beds = item.bedrooms if item.bedrooms is not None else criteria.bedrooms
        try:
            out.append(
                Listing(
                    id=new_id("lst"),
                    session_id=session_id,
                    source_site=source_site,
                    url=item.link,
                    image_url=item.photo,
                    rent=item.rent,
                    area_sqft=item.area_sqft,
                    bedrooms=beds,
                    locality=locality,
                    title=f"{beds} BHK in {locality}" if beds and locality else None,
                )
            )
        except ValidationError:
            # One malformed link or photograph costs that listing, not the page.
            log.debug("html_listings: skipped %s", item.link, exc_info=True)
        if limit is not None and len(out) >= limit:
            break
    return out
