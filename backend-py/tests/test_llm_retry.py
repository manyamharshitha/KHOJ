"""A failure that cannot go differently is not retried.

The free tier allows twenty requests a day. Every `complete_json` retried three
times on any LLMError, and a truncated response raised one — so a single page
that overran the token ceiling spent three requests failing identically, at
fifteen per cent of a day's budget. Two pages exhausted the day.

The distinction is whether a second attempt could plausibly differ. A timeout or
a 5xx could. A deterministic cut at the same ceiling, from the same prompt at
temperature zero, cannot.
"""

from __future__ import annotations

from app.llm.client import (
    LLMError,
    LLMOutputTruncated,
    LLMUnavailable,
    _worth_another_attempt,
)


def test_a_truncated_answer_is_not_retried() -> None:
    """Same prompt, same ceiling, same cut — three times over."""
    assert not _worth_another_attempt(LLMOutputTruncated("cut off at 32768 tokens"))


def test_missing_credentials_are_not_retried() -> None:
    """A third attempt will not discover an API key."""
    assert not _worth_another_attempt(LLMUnavailable("no key configured"))


def test_a_transient_failure_is_retried() -> None:
    """A timeout or a 5xx is exactly what the retry exists for."""
    assert _worth_another_attempt(LLMError("gemini call failed: 503"))


def test_truncation_is_an_llm_error_for_callers() -> None:
    """Callers catching LLMError must still catch this one.

    `extract_listings` catches LLMError and returns an empty list so one
    unreadable page does not sink a five-site search. A truncation that escaped
    that would crash the whole run.
    """
    assert isinstance(LLMOutputTruncated("x"), LLMError)


def test_an_unrelated_exception_is_not_retried() -> None:
    assert not _worth_another_attempt(ValueError("not an LLM problem"))
