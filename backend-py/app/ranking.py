"""Deterministic priority ranking.

Not an LLM call. The customer asked for cheapest-first with newest as the
tie-breaker, and that is arithmetic — running it through a model would make a
sort order non-reproducible and unexplainable for no benefit.

The rules, in order:

1. **Total monthly outflow ascending** — ``rent + maintenance``. Portals
   advertise rent and hide maintenance, so ranking on rent alone reproduces the
   exact deception the product exists to expose.
2. **Building age ascending** — newer wins ties.
3. Listings whose cost cannot be established sort last, never first.
"""

from __future__ import annotations

import logging
from typing import Final

from app.models import Listing, SearchCriteria

log = logging.getLogger(__name__)

#: Sorts unknowns last without pretending they are expensive.
_UNKNOWN: Final = float("inf")


def sort_key(listing: Listing) -> tuple[int, float, float, float]:
    """The ordering tuple for one listing.

    Returns ``(unknown_cost, total_cost, age_years, -match_score)``.

    The leading flag is what keeps a listing with no rent out of first place. A
    ``None`` cost is not zero; treating it as zero would put every listing whose
    price the site hid at the very top, which is precisely backwards.

    Age falls back to infinity for the same reason: an unknown-age building
    should not beat one documented as new.

    Match score breaks a remaining tie, negated so higher scores come first.
    """
    total = listing.total_monthly_cost
    return (
        0 if total is not None else 1,
        float(total) if total is not None else _UNKNOWN,
        listing.age_years if listing.age_years is not None else _UNKNOWN,
        -(listing.ai_match_score or 0.0),
    )


def rank_listings(listings: list[Listing]) -> list[Listing]:
    """Cheapest first, newest to break ties. Stable and pure."""
    return sorted(listings, key=sort_key)


def filter_hard_constraints(
    listings: list[Listing], criteria: SearchCriteria
) -> tuple[list[Listing], list[tuple[Listing, str]]]:
    """Split listings into those that survive the customer's hard limits and those that do not.

    Only constraints she stated as numbers are applied, and only when the
    listing actually carries the field. A listing with an unknown deposit is
    *not* excluded by a deposit ceiling — the unknown is what the phone call is
    for, and discarding it here would hide a possibly-perfect home because a
    portal was vague.

    Returns ``(kept, [(dropped, reason), ...])`` so the customer can be shown
    what was excluded and why.
    """
    kept: list[Listing] = []
    dropped: list[tuple[Listing, str]] = []

    for listing in listings:
        reason: str | None = None
        total = listing.total_monthly_cost

        if criteria.max_total_monthly is not None and total is not None:
            if total > criteria.max_total_monthly:
                reason = (
                    f"Rs {total:,}/month all-in is over your Rs "
                    f"{criteria.max_total_monthly:,} ceiling"
                )

        if (
            reason is None
            and criteria.max_deposit is not None
            and listing.deposit is not None
            and listing.deposit > criteria.max_deposit
        ):
            reason = f"deposit Rs {listing.deposit:,} is over your Rs {criteria.max_deposit:,} limit"

        if (
            reason is None
            and criteria.max_property_age_years is not None
            and listing.age_years is not None
            and listing.age_years > criteria.max_property_age_years
        ):
            reason = (
                f"{listing.age_years:g} years old, older than the "
                f"{criteria.max_property_age_years:g} you asked for"
            )

        if (
            reason is None
            and criteria.bedrooms is not None
            and listing.bedrooms is not None
            and listing.bedrooms != criteria.bedrooms
        ):
            reason = f"{listing.bedrooms}BHK, you asked for {criteria.bedrooms}BHK"

        if (
            reason is None
            and criteria.max_brokerage_months is not None
            and listing.brokerage_months is not None
            and listing.brokerage_months > criteria.max_brokerage_months
        ):
            reason = f"{listing.brokerage_months:g} months brokerage is more than you wanted"

        if reason:
            dropped.append((listing, reason))
        else:
            kept.append(listing)

    if dropped:
        log.info("ranking: %d listing(s) failed a stated hard constraint", len(dropped))
    return kept, dropped


def call_order(listings: list[Listing], limit: int) -> list[Listing]:
    """The listings to actually phone, cheapest first.

    Only listings with a number are dialable, so the rest are filtered out here
    rather than failing one at a time in the dialer.
    """
    callable_listings = [x for x in rank_listings(listings) if x.is_callable]
    if len(callable_listings) < len(listings):
        log.info(
            "ranking: %d of %d listings have no contact number to dial",
            len(listings) - len(callable_listings),
            len(listings),
        )
    return callable_listings[:limit]


def explain_order(listings: list[Listing], top: int = 5) -> str:
    """A human-readable summary of why the order came out as it did."""
    lines: list[str] = []
    for i, listing in enumerate(rank_listings(listings)[:top], start=1):
        total = listing.total_monthly_cost
        cost = f"Rs {total:,}" if total is not None else "cost unknown"
        age = f"{listing.age_years:g}y" if listing.age_years is not None else "age unknown"
        lines.append(f"{i}. {listing.title or listing.locality or listing.id} — {cost}, {age}")
    return "\n".join(lines)
