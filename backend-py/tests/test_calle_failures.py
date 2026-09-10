"""What the customer is told when a call does not connect.

CALL-E reports the useful part as a SIP code and leaves ``failure_message``
empty, falling back to the string ``"calling task status=FAILED"`` on the task.
That is what reached the results panel: a red banner restating that the call
failed and identifying nothing. A 404 (no route to the number) and a 503 (the
provider's own trunk is down) are completely different problems with completely
different owners, and both read identically.
"""

from __future__ import annotations

from app.models import CallStatus
from app.telephony.calle_dialer import _map_status, describe_failure


def test_the_generic_restatement_is_never_shown() -> None:
    """The exact string that was reaching customers."""
    task = {"status": "failed", "failure_message": "calling task status=FAILED"}
    attempt = {"failure_code": "503"}

    message = describe_failure(task, attempt)

    assert "status=FAILED" not in message
    assert "503" in message


def test_a_missing_route_says_so() -> None:
    message = describe_failure({"status": "failed"}, {"failure_code": "404"})
    assert "no route" in message
    assert "+91" in message


def test_a_provider_outage_does_not_blame_the_recipient() -> None:
    """503 is the trunk, not the person. CALL-E's own summary gets this wrong."""
    message = describe_failure({"status": "failed"}, {"failure_code": "503"})
    assert "provider" in message
    assert "Nothing rang" in message


def test_an_unknown_code_admits_it() -> None:
    message = describe_failure({"status": "failed"}, {"failure_code": "599"})
    assert "599" in message


def test_a_real_provider_message_is_kept() -> None:
    task = {"status": "failed", "failure_message": "insufficient balance"}
    assert describe_failure(task, {}) == "insufficient balance"


def test_no_reason_at_all_is_stated_plainly() -> None:
    message = describe_failure({"status": "failed"}, {})
    assert "no reason" in message


# --------------------------------------------------------------------------
# numeric SIP codes must map to the right status
# --------------------------------------------------------------------------


def test_486_is_busy_not_a_generic_failure() -> None:
    """"busy" is not a substring of "486", which is how this was missed."""
    assert _map_status({"status": "failed"}, {"failure_code": "486"}) is CallStatus.BUSY


def test_408_is_a_genuine_unanswered_ring() -> None:
    assert _map_status({"status": "failed"}, {"failure_code": "408"}) is CallStatus.NO_ANSWER


def test_503_is_failed_and_never_no_answer() -> None:
    """Nothing rang, so reporting "nobody answered" invents an event."""
    assert _map_status({"status": "failed"}, {"failure_code": "503"}) is CallStatus.FAILED


def test_404_is_failed_and_never_no_answer() -> None:
    assert _map_status({"status": "failed"}, {"failure_code": "404"}) is CallStatus.FAILED


def test_487_is_cancelled() -> None:
    assert _map_status({"status": "failed"}, {"failure_code": "487"}) is CallStatus.CANCELLED
