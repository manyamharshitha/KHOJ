"""A worker that is killed leaves searches behind. Boot must clean them up.

This is the failure no exception handler reaches. ``run_search`` is a background
task inside the web process; when that process is killed rather than raising —
OOM from Chromium, a deploy, a platform restart — no ``except`` runs, no
``finally`` runs and no ``asyncio.wait_for`` fires, because all three are code
and the process is gone. The session stays in ``scraping``, and the customer
watches a progress bar that will never move.

The only place this can be repaired is the next boot, which knows that anything
still marked in-flight cannot be.
"""

from __future__ import annotations

from datetime import timedelta

import pytest

from app import repositories as repo
from app.models import SearchCriteria, SearchSession, SessionStatus, utcnow

pytestmark = pytest.mark.usefixtures("mongo_db")


def a_session(session_id: str, status: SessionStatus) -> SearchSession:
    return SearchSession(
        id=session_id,
        customer_id="usr_1",
        prompt="2BHK in Kondapur",
        criteria=SearchCriteria(),
        target_sites=[{"name": "zolo", "url": "https://zolostays.com/", "contact_gated": False}],
        status=status,
    )


async def _age(session_id: str, minutes: int) -> None:
    """Backdate a session's updated_at, as an abandoned one would be."""
    await repo.get_db()[repo.SESSIONS].update_one(
        {"_id": session_id}, {"$set": {"updated_at": utcnow() - timedelta(minutes=minutes)}}
    )


async def test_a_stale_scraping_session_is_failed() -> None:
    await repo.create_session(a_session("ses_stuck", SessionStatus.SCRAPING))
    await _age("ses_stuck", 60)

    assert await repo.fail_orphaned_sessions(timedelta(minutes=15)) == 1

    stored = await repo.get_session("ses_stuck")
    assert stored.status is SessionStatus.FAILED
    assert "restarted" in stored.error


async def test_extracting_and_queued_are_reaped_too() -> None:
    await repo.create_session(a_session("ses_x", SessionStatus.EXTRACTING))
    await repo.create_session(a_session("ses_q", SessionStatus.QUEUED))
    await _age("ses_x", 60)
    await _age("ses_q", 60)

    assert await repo.fail_orphaned_sessions(timedelta(minutes=15)) == 2


async def test_a_recent_session_is_left_alone() -> None:
    """Another instance may be running it right now."""
    await repo.create_session(a_session("ses_live", SessionStatus.SCRAPING))

    assert await repo.fail_orphaned_sessions(timedelta(minutes=15)) == 0
    assert (await repo.get_session("ses_live")).status is SessionStatus.SCRAPING


async def test_finished_sessions_are_never_touched() -> None:
    """Reaping must not rewrite a search that completed perfectly well."""
    await repo.create_session(a_session("ses_done", SessionStatus.COMPLETE))
    await repo.create_session(a_session("ses_ranked", SessionStatus.RANKED))
    await _age("ses_done", 600)
    await _age("ses_ranked", 600)

    assert await repo.fail_orphaned_sessions(timedelta(minutes=15)) == 0
    assert (await repo.get_session("ses_done")).status is SessionStatus.COMPLETE
    assert (await repo.get_session("ses_ranked")).status is SessionStatus.RANKED
