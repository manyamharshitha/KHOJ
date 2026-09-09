"""A search that hangs must still end.

``run_search`` is dispatched as a background task with nobody awaiting it, so a
coroutine that never returns is invisible from the outside: no exception, no
log, and a session left in ``scraping`` forever. The customer reads that as
"still working" and waits indefinitely.

Every await in the search path is therefore bounded, and the whole thing sits
inside a deadline. These prove the session reaches a terminal status whatever
happens underneath it.
"""

from __future__ import annotations

import asyncio

import pytest

from app import pipeline, repositories as repo
from app.config import settings
from app.models import SearchCriteria, SearchSession, SessionStatus, TargetSite

pytestmark = pytest.mark.usefixtures("mongo_db")


def a_session(session_id: str = "ses_hang") -> SearchSession:
    return SearchSession(
        id=session_id,
        customer_id="usr_1",
        prompt="2BHK in Kondapur under 25000",
        criteria=SearchCriteria(city="Hyderabad", localities=["Kondapur"]),
        target_sites=[TargetSite(name="zolo", url="https://zolostays.com/")],
    )


async def test_a_hung_search_is_failed_rather_than_left_running(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The exact shape of the bug: the crawl never returns."""
    session = a_session()
    await repo.create_session(session)

    async def never_returns(*_a, **_k):
        await asyncio.sleep(3600)

    monkeypatch.setattr(pipeline, "crawl", never_returns)
    monkeypatch.setattr(settings, "search_timeout_s", 0.1)

    await pipeline.run_search(session)

    stored = await repo.get_session("ses_hang")
    assert stored.status is SessionStatus.FAILED
    assert "too long" in stored.error


async def test_a_crashing_search_is_failed_with_the_reason(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    session = a_session()
    await repo.create_session(session)

    async def explodes(*_a, **_k):
        raise RuntimeError("chromium is not installed")

    monkeypatch.setattr(pipeline, "crawl", explodes)

    await pipeline.run_search(session)

    stored = await repo.get_session("ses_hang")
    assert stored.status is SessionStatus.FAILED
    assert "chromium" in stored.error


async def test_cancellation_is_recorded_before_the_task_dies(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A deploy mid-search must not leave the session mid-flight forever."""
    session = a_session()
    await repo.create_session(session)

    async def cancelled(*_a, **_k):
        raise asyncio.CancelledError()

    monkeypatch.setattr(pipeline, "crawl", cancelled)

    # The cancellation is re-raised on purpose — swallowing it would tell the
    # event loop the task stopped when it had not.
    with pytest.raises(asyncio.CancelledError):
        await pipeline.run_search(session)

    stored = await repo.get_session("ses_hang")
    assert stored.status is SessionStatus.FAILED
    assert "interrupted" in stored.error


async def test_a_search_never_stays_in_a_running_status() -> None:
    """Whatever happens, `scraping` is not where a finished search sits.

    This is the property the customer actually experiences: the spinner stops.
    """
    session = a_session()
    await repo.create_session(session)

    # No monkeypatching: whatever the real crawl does on this machine — most
    # likely fail to start a browser — the status must not be a running one.
    await pipeline.run_search(session)

    stored = await repo.get_session("ses_hang")
    assert stored.status not in (
        SessionStatus.QUEUED,
        SessionStatus.SCRAPING,
        SessionStatus.EXTRACTING,
    )
