

from __future__ import annotations

import logging
import re
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field

from app.config import settings
from app.llm.client import LLMError, complete_model, llm_available
from app.models import Listing, SearchCriteria
from app.ids import new_id

log = logging.getLogger(__name__)
_PHONE_RUN = re.compile(r"\+?\d[\d\s\-().]{7,18}\d")


def to_e164(raw: str) -> str | None:
    """Normalise an Indian phone number, or return None if it cannot be dialled.

    Indian mobiles are ten digits starting 6-9. A ten-digit number starting with
    5 is a typo, not a phone, and a five-digit number is a rent.
    """
    digits = re.sub(r"[^\d+]", "", raw)
    if digits.startswith("+"):
        return digits if re.fullmatch(r"\+[1-9]\d{7,14}", digits) else None
    bare = digits.lstrip("0")
    if re.fullmatch(r"91[6-9]\d{9}", bare):
        return f"+{bare}"
    if re.fullmatch(r"[6-9]\d{9}", bare):
        return f"+91{bare}"
    return None


def extract_phone_candidates(text: str) -> list[str]:
    """Every dialable number in the page, in order, deduplicated.

    Deterministic on purpose — see the module docstring.
    """
    seen: set[str] = set()
    out: list[str] = []
    for run in _PHONE_RUN.findall(text):
        e164 = to_e164(run)
        if e164 and e164 not in seen:
            seen.add(e164)
            out.append(e164)
    return out


class ExtractedListing(BaseModel):
    """One property as the model read it off the page."""

    model_config = ConfigDict(extra="forbid")

    title: str | None = None
    locality: str | None = None
    property_type: str | None = None
    bedrooms: int | None = Field(default=None, ge=0, le=20)

    rent: int | None = Field(default=None, ge=0)
    maintenance: int | None = Field(default=None, ge=0)
    deposit: int | None = Field(default=None, ge=0)
    brokerage_months: float | None = Field(default=None, ge=0, le=12)

    age_years: float | None = Field(default=None, ge=0, le=200)
    furnishing: str | None = None
    amenities: list[str] = Field(default_factory=list)

    contact_number: str | None = Field(
        default=None, description="Copied exactly from the page, or null."
    )
    contact_name: str | None = None
    is_broker: bool | None = None

    listing_url: str | None = None
    image_url: str | None = Field(
        default=None,
        description=(
            "The photograph of THIS property, copied exactly from the page. Null "
            "if the page shows no photo for it."
        ),
    )
    area_sqft: int | None = Field(default=None, ge=0, le=100_000)

    match_score: Annotated[float, Field(ge=0.0, le=1.0)] = 0.0
    match_reason: str = ""


class ExtractionResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    listings: list[ExtractedListing] = Field(default_factory=list)


SYSTEM = """\
You read the text of a rental listing page from an Indian property site and pull
out the properties on it.

Record only what the page states. If a page does not give the maintenance
charge, leave it null — do not put zero, and do not fold it into the rent. If it
does not give the building's age, leave it null; "recently constructed" is not a
number. Never carry a value from one listing to another because they look
similar.

A null field costs the customer one phone call to find out. A wrong field sends
her across the city for a flat that was never what she thought. Null is always
the safer answer.

Field notes:

- rent and maintenance are separate. Many pages advertise rent and mention
  maintenance elsewhere, or not at all. Keep them apart; something downstream
  adds them.
- All money is a plain integer of rupees. "32k" is 32000. "1.2 L" is 120000.
  "25,000/month" is 25000.
- brokerage_months is in months of rent: "one month brokerage" is 1, "no
  brokerage" is 0, silence is null.
- age_years: "3 year old property" is 3, "ready to move" is null, "under
  construction" is 0.
- is_broker: true when the page identifies the contact as an agent, dealer,
  broker or consultancy; false when it says owner. Null if it does not say.
- contact_number: copy digits that appear on the page, exactly. If the page hides
  the number behind "view contact" or a login, leave it null. Never construct a
  plausible-looking number. Some pages (a managed co-living operator's city
  listing, say) give one central number for the whole page rather than one per
  listing — if that is the only number present, use it for every listing.
- area_sqft: the built-up or carpet area in square feet, as an integer. "1,050
  sq.ft." is 1050. If the page gives square yards or square metres, leave it
  null rather than converting — a converted number read as a quoted one is
  worse than no number.
- listing_url: the link to THIS property's own page, copied exactly. Not the
  search page it was found on. Null if the page gives no per-listing link.
- image_url: the photograph of THIS property, copied exactly from the page.
  Null if there is none.

  Take care over which image belongs to which listing, because these two fields
  are the ones a mistake is least visible in. A wrong rent is caught the moment
  she reads it; a wrong photograph is believed, and she travels across the city
  expecting the flat in the picture. Do not reuse one listing's photo for its
  neighbours, and never use a site logo, a banner, an advertisement, a map tile,
  an agent's headshot or a placeholder graphic. If you are not sure a photo
  belongs to this property, null is the answer.

For each listing also judge how well it matches the customer's requirements,
which are given to you below.

- match_score is 0.0 to 1.0. Weigh her stated must-haves most heavily. A listing
  missing information is not a bad match — it is an unknown one, so score it in
  the middle rather than at zero.
- match_reason is one short sentence naming the specific thing that made it a
  good or bad fit. Not "matches your criteria" — say which criterion.

If the page has no property listings on it at all, return an empty list.
"""


def _url_on_page(candidate: str | None, page_text: str) -> str | None:
    """The URL, if the page really contains it. Otherwise None.

    The same rule the phone numbers are held to, for the same reason: a model
    reading a page of property links will happily produce one that looks exactly
    like the others and was on no page at all. Checking costs a substring scan.

    Only http(s) survives. A `javascript:` or `data:` string reaching an href or
    an <img src> is a scripting vector, and neither belongs in a field copied
    off someone else's page.
    """
    if not candidate:
        return None
    url = candidate.strip()
    if not url.lower().startswith(("http://", "https://")):
        return None
    return url if url in page_text else None


async def extract_listings(
    *,
    session_id: str,
    source_site: str,
    page_text: str,
    page_url: str | None,
    criteria: SearchCriteria,
    criteria_text: str,
    max_listings: int = 25,
) -> list[Listing]:
    """Extract and score listings from one page.

    Returns an empty list rather than raising when the model is unavailable or
    fails: one unreadable site should not sink a five-site search.
    """
    if not page_text.strip():
        return []

    page_phones = extract_phone_candidates(page_text)

    if not llm_available():
        log.warning("extractor: no LLM configured, skipping %s", source_site)
        return []

    user = (
        f"The customer is looking for: {criteria_text}\n\n"
        f"Her structured requirements:\n{criteria.model_dump_json(indent=2, exclude_none=True)}\n\n"
        f"Page from {source_site}"
        + (f" ({page_url})" if page_url else "")
        + f":\n\n{page_text[:120_000]}"
    )

    try:
        result = await complete_model(
            system=SYSTEM,
            user=user,
            output=ExtractionResult,
            temperature=0.0,
            max_tokens=settings.extraction_max_tokens,
        )
    except LLMError as exc:
        log.warning("extractor: %s failed (%s)", source_site, exc)
        return []

    listings: list[Listing] = []
    dropped_numbers = 0
    dropped_urls = 0

    for item in result.listings[:max_listings]:
        contact = None
        if item.contact_number:
            candidate = to_e164(item.contact_number)
            if candidate and candidate in page_phones:
                contact = candidate
            else:
                dropped_numbers += 1
        if contact is None and len(page_phones) == 1 and len(result.listings) == 1:
            contact = page_phones[0]

        # Held to the same standard as the phone number above: a URL is used
        # only if it is actually on the page.
        #
        # A fabricated link is worse than none, and quieter. It looks right,
        # resolves to a 404 or — worse — to some other property, and the
        # customer concludes the listing was a lie rather than that the link
        # was. The photograph is the same bet with a higher stake: she believes
        # a picture in a way she never believes a number.
        listing_link = _url_on_page(item.listing_url, page_text)
        image = _url_on_page(item.image_url, page_text)
        dropped_urls += (item.listing_url is not None and listing_link is None) + (
            item.image_url is not None and image is None
        )

        listings.append(
            Listing(
                id=new_id("lst"),
                session_id=session_id,
                source_site=source_site,
                url=listing_link or page_url,
                image_url=image,
                area_sqft=item.area_sqft,
                raw_excerpt=page_text[:8000],
                title=item.title,
                locality=item.locality,
                property_type=item.property_type,
                bedrooms=item.bedrooms,
                rent=item.rent,
                maintenance=item.maintenance,
                deposit=item.deposit,
                brokerage_months=item.brokerage_months,
                age_years=item.age_years,
                furnishing=item.furnishing,
                amenities=item.amenities,
                contact_number=contact,
                contact_name=item.contact_name,
                is_broker=item.is_broker,
                ai_match_score=item.match_score,
                ai_match_reason=item.match_reason or None,
            )
        )

    if dropped_numbers:
        log.warning(
            "extractor: %s — dropped %d phone number(s) not present in the page",
            source_site,
            dropped_numbers,
        )
    if dropped_urls:
        log.warning(
            "extractor: %s — dropped %d link(s) or image(s) not present in the page",
            source_site,
            dropped_urls,
        )
    log.info("extractor: %s yielded %d listing(s)", source_site, len(listings))
    return listings
