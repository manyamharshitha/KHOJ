"""A call the network refused is dialled again. One a person answered is not.

The provider is measurably intermittent on Indian mobiles: the same number,
with a byte-identical payload, completed a call at 05:26 and was answered with
"no route" at 05:51. A single attempt makes the product look broken when the
carrier is merely flaky.

The line that matters is which failures qualify. FAILED means the network
refused the call before it reached anyone — nothing rang, so retrying disturbs
nobody. NO_ANSWER and BUSY mean a telephone rang in a stranger's hand, and
ringing it again because our provider was unreliable puts our cost on them.
"""

from __future__ import annotations

from app.models import CallStatus
from app.pipeline import _WORTH_RETRYING


def test_a_call_that_never_rang_is_retried() -> None:
    assert CallStatus.FAILED in _WORTH_RETRYING


def test_a_telephone_that_actually_rang_is_never_retried() -> None:
    """Each of these reached a real person. Once is enough."""
    for status in (CallStatus.NO_ANSWER, CallStatus.BUSY, CallStatus.COMPLETED):
        assert status not in _WORTH_RETRYING, f"{status} rang a real phone"


def test_a_blocked_or_cancelled_call_is_not_retried() -> None:
    """BLOCKED is the cooldown refusing on purpose; retrying would defeat it."""
    assert CallStatus.BLOCKED not in _WORTH_RETRYING
    assert CallStatus.CANCELLED not in _WORTH_RETRYING


def test_retries_are_bounded_and_spaced() -> None:
    """Each attempt is a real call the provider may bill."""
    from app.config import settings

    assert settings.call_attempts >= 1
    assert settings.call_attempts <= 3, "more than three attempts bills for nothing"
    assert settings.call_retry_delay_s > 0, "a retry with no pause repeats the same fault"
