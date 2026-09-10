"""Chromium is not launched on a host that cannot afford it.

The failure this prevents cannot be handled any other way. Chromium wants
roughly 400MB at startup; a 512MB instance already holding Python, FastAPI, the
Motor pool and the model clients does not have it, and the kernel's answer is
SIGKILL. A signal is not an exception — no ``except`` runs, no ``finally`` runs,
no timeout fires. The process disappears mid-request, taking every other
customer's search and call with it, and the platform answers 503 without CORS
headers so the browser blames CORS.

So the decision is made before the browser starts, and these pin it.
"""

from __future__ import annotations

import pytest

from app.config import settings
from app.scraping import capacity


def test_an_explicit_yes_is_obeyed(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "enable_headless_scraping", True)
    # Even with almost nothing free: an operator who says yes has presumably
    # moved to a bigger box or knows something this check does not.
    monkeypatch.setattr(capacity, "available_memory_mb", lambda: 50)

    allowed, why = capacity.headless_available()
    assert allowed
    assert "explicitly" in why


def test_an_explicit_no_is_obeyed(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "enable_headless_scraping", False)
    monkeypatch.setattr(capacity, "available_memory_mb", lambda: 8000)

    allowed, why = capacity.headless_available()
    assert not allowed
    assert "ENABLE_HEADLESS_SCRAPING" in why


def test_a_starved_host_is_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    """The 512MB Render instance, which is the whole reason this exists."""
    monkeypatch.setattr(settings, "enable_headless_scraping", None)
    monkeypatch.setattr(settings, "headless_memory_floor_mb", 600)
    monkeypatch.setattr(capacity, "available_memory_mb", lambda: 380)

    allowed, why = capacity.headless_available()
    assert not allowed
    assert "380MB" in why


def test_a_roomy_host_is_allowed(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "enable_headless_scraping", None)
    monkeypatch.setattr(settings, "headless_memory_floor_mb", 600)
    monkeypatch.setattr(capacity, "available_memory_mb", lambda: 4096)

    allowed, why = capacity.headless_available()
    assert allowed
    assert "4096MB" in why


def test_a_host_that_cannot_be_measured_is_allowed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """No /proc/meminfo means not Linux, so not one of the constrained hosts.

    Refusing to crawl on a developer's laptop because the file is missing would
    break local work to guard against a limit that machine does not have.
    """
    monkeypatch.setattr(settings, "enable_headless_scraping", None)
    monkeypatch.setattr(capacity, "available_memory_mb", lambda: None)

    allowed, why = capacity.headless_available()
    assert allowed
    assert "development host" in why


def test_the_floor_sits_above_what_chromium_needs() -> None:
    """A floor at Chromium's own footprint leaves nothing for the request."""
    assert settings.headless_memory_floor_mb >= 500


def test_available_memory_is_a_number_or_none() -> None:
    """Whatever the host, this must not raise — it runs inside a boot path."""
    value = capacity.available_memory_mb()
    assert value is None or (isinstance(value, int) and value >= 0)


# --------------------------------------------------------------------------
# end to end: a starved host still answers
# --------------------------------------------------------------------------


@pytest.mark.usefixtures("mongo_db")
async def test_a_starved_host_returns_native_listings_and_stays_alive(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The whole point, exercised through run_search.

    No browser is launched, the process survives, and the customer gets the
    listings Khoj holds itself rather than an error — or, as before, a dead
    worker and a 503 the browser reports as CORS.
    """
    from app import pipeline, repositories as repo
    from app.models import (
        KHOJ_SOURCE,
        Listing,
        SearchCriteria,
        SearchSession,
        SessionStatus,
        TargetSite,
    )

    monkeypatch.setattr(settings, "enable_headless_scraping", False)

    # If anything reaches the crawler this fails loudly rather than quietly
    # launching Chromium on the host running the tests.
    async def must_not_run(*_a, **_k):
        raise AssertionError("the crawler was launched on a host that refused it")

    monkeypatch.setattr(pipeline, "crawl", must_not_run)

    session = SearchSession(
        id="ses_oom",
        customer_id="usr_1",
        prompt="2BHK in Kondapur",
        criteria=SearchCriteria(localities=["Kondapur"]),
        target_sites=[TargetSite(name="zolo", url="https://zolostays.com/")],
    )
    await repo.create_session(session)
    await repo.save_listings(
        [
            Listing(
                id="lst_native",
                session_id="ses_owner",
                source_site=KHOJ_SOURCE,
                listed_by_owner=True,
                owner_id="usr_owner",
                title="2BHK in Kondapur",
                locality="Kondapur",
                bedrooms=2,
                rent=22000,
                contact_number="+919000000001",
            )
        ]
    )

    await pipeline.run_search(session)

    stored = await repo.get_session("ses_oom")
    assert stored.status is SessionStatus.RANKED, "a memory limit must not FAIL the search"

    found = await repo.listings_for_session("ses_oom")
    assert len(found) == 1, "Khoj's own listings are the fallback and must be returned"
    assert "memory" in (stored.error or ""), "the customer should be told why it is short"
