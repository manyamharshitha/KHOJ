"""Distance between two points, and addresses turned into points.

The distance check is what makes a site visit mean anything: without it a
"verification" is a video that could have been shot anywhere. It is also the
part most likely to be wrong in a way nobody notices, so it is computed here
rather than inline, and it is exact rather than approximated by comparing
degrees.

Geocoding needs Google Maps and degrades to ``None`` without a key. A visit with
no expected point is reported as un-checkable rather than as verified: the whole
claim is "this video came from that address", and with no coordinates for the
address there is nothing to compare against.
"""

from __future__ import annotations

import logging
import math

import httpx

from app.config import settings

log = logging.getLogger(__name__)

#: Mean Earth radius, metres. Good to ~0.5% anywhere, which is centimetres at
#: the distances this is used for.
_EARTH_M = 6_371_000.0

_GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json"


def haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Great-circle distance in metres.

    Not a flat-earth approximation on the degrees: one degree of longitude is
    111km at the equator and 96km in Delhi, so comparing raw degree deltas would
    make the same tolerance mean different things in different cities.
    """
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * _EARTH_M * math.asin(math.sqrt(a))


def geocoding_available() -> bool:
    return bool(settings.google_maps_api_key)


async def geocode(address: str) -> tuple[float, float] | None:
    """``(lat, lng)`` for an address, or ``None``.

    ``None`` covers every failure the same way on purpose — no key, no result,
    a rate limit, a timeout. The caller's decision is identical in all of them:
    record that the point is unknown and do not pretend the visit was checked.
    """
    address = (address or "").strip()
    if not address or not geocoding_available():
        return None

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                _GEOCODE_URL,
                params={
                    "address": address,
                    "key": settings.google_maps_api_key,
                    "region": "in",
                },
            )
            response.raise_for_status()
            body = response.json()
    except Exception as exc:  # noqa: BLE001 - one unresolved address, not a crash
        log.warning("geo: could not geocode %r (%s)", address[:60], exc)
        return None

    status = body.get("status")
    if status != "OK" or not body.get("results"):
        log.info("geo: %r returned %s", address[:60], status)
        return None

    point = body["results"][0]["geometry"]["location"]
    return float(point["lat"]), float(point["lng"])
