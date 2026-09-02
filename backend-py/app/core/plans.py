"""Subscription tiers and the quota they buy.

Every verified listing costs a real phone call, so the quota is not decoration —
it is the thing standing between a free account and an unbounded telephony bill.
It is therefore enforced in two places, deliberately:

* at **ranking**, where the sorted list is clipped to the tier's limit, so a
  customer is never shown results the plan will not actually verify; and
* at **dialling**, immediately before each call is placed, because a plan can be
  downgraded or a quota consumed by another session between those two moments.

Checking only at ranking would let a long-running search outlive the plan that
authorised it.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum


class Tier(StrEnum):
    FREE = "free"
    SILVER = "silver"
    GOLD = "gold"
    PREMIUM = "premium"


#: Listings processed *and verified by phone* per plan.
PLAN_LIMITS: dict[str, int] = {
    Tier.FREE: 2,
    Tier.SILVER: 6,
    Tier.GOLD: 15,
    Tier.PREMIUM: 25,
}

#: Shown in the UI. Not billing logic — no money changes hands in this codebase.
PLAN_PRICING_INR: dict[str, int] = {
    Tier.FREE: 0,
    Tier.SILVER: 299,
    Tier.GOLD: 699,
    Tier.PREMIUM: 1499,
}

#: Above this, the customer is pointed at the custom agency flow instead.
CUSTOM_AGENCY_THRESHOLD = PLAN_LIMITS[Tier.PREMIUM]

DEFAULT_TIER = Tier.FREE


@dataclass(frozen=True, slots=True)
class Quota:
    """What a user may still do right now."""

    tier: Tier
    limit: int
    used: int

    @property
    def remaining(self) -> int:
        """Never negative — a tier downgrade can leave `used` above `limit`."""
        return max(0, self.limit - self.used)

    @property
    def exhausted(self) -> bool:
        return self.remaining <= 0

    def message(self) -> str:
        """What to tell the customer when they run out.

        Names the tier they are on and the next step, rather than just refusing.
        Someone who hits a wall with no route past it simply leaves.
        """
        if not self.exhausted:
            return f"{self.remaining} of {self.limit} verifications left on your {self.tier} plan."
        if self.tier is Tier.PREMIUM:
            return (
                f"You have used all {self.limit} verifications on Premium. "
                "Need more than 25 a day? Leave your email and we will set up a "
                "custom agency plan."
            )
        return (
            f"You have used all {self.limit} verifications on the {self.tier} plan. "
            f"Upgrade to {next_tier(self.tier)} for more."
        )


def normalise_tier(value: str | None) -> Tier:
    """Coerce a stored string to a tier.

    An unrecognised value falls back to free rather than raising. A corrupt tier
    field should cost a user their upgrade, not lock them out of the product.
    """
    if not value:
        return DEFAULT_TIER
    try:
        return Tier(value.strip().lower())
    except ValueError:
        return DEFAULT_TIER


def limit_for(tier: str | Tier | None) -> int:
    """Listings a tier may verify."""
    return PLAN_LIMITS[normalise_tier(str(tier) if tier else None)]


def next_tier(tier: Tier) -> Tier:
    """The tier above this one. Premium is the top."""
    order = [Tier.FREE, Tier.SILVER, Tier.GOLD, Tier.PREMIUM]
    index = order.index(tier)
    return order[min(index + 1, len(order) - 1)]


def clip_to_plan(items: list, tier: str | Tier, used: int = 0) -> tuple[list, int]:
    """Cut a ranked list down to what the plan will actually verify.

    Returns ``(kept, dropped_count)``. Applied *after* ranking, never before —
    clipping an unsorted list would discard the cheapest properties, which is the
    exact opposite of what the customer is paying for.
    """
    allowance = max(0, limit_for(tier) - max(0, used))
    if len(items) <= allowance:
        return items, 0
    return items[:allowance], len(items) - allowance


def plan_catalogue() -> list[dict[str, object]]:
    """Every plan, for the pricing UI."""
    return [
        {
            "tier": tier.value,
            "listings_limit": PLAN_LIMITS[tier],
            "price_inr": PLAN_PRICING_INR[tier],
            "is_default": tier is DEFAULT_TIER,
        }
        for tier in (Tier.FREE, Tier.SILVER, Tier.GOLD, Tier.PREMIUM)
    ]
