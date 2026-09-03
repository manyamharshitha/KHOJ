"""Verify the local Khoj backend before browser end-to-end tests.

Run from the repository root with:

    backend-py\\.venv\\Scripts\\python.exe scripts\\verify_local_system.py

The backend URL and session can be overridden with ``KHOJ_BASE_URL`` and
``KHOJ_SESSION_ID`` when verifying a different local fixture.
"""

from __future__ import annotations

import os
import sys
import time
from collections.abc import Callable
from typing import Any

import httpx


BASE_URL = os.getenv("KHOJ_BASE_URL", "http://localhost:8010").rstrip("/")
SESSION_ID = os.getenv("KHOJ_SESSION_ID", "ses_1a06391761d9dbbe849")
TIMEOUT_SECONDS = float(os.getenv("KHOJ_VERIFY_TIMEOUT", "30"))


class Colour:
    GREEN = "\033[32m"
    RED = "\033[31m"
    YELLOW = "\033[33m"
    CYAN = "\033[36m"
    RESET = "\033[0m"


def _colour(text: str, code: str) -> str:
    return text if os.getenv("NO_COLOR") else f"{code}{text}{Colour.RESET}"


def log_pass(message: str, latency: float) -> None:
    print(f"{_colour('[PASS]', Colour.GREEN)} {message} ({latency:.0f} ms)")


def log_fail(message: str, latency: float | None = None) -> None:
    suffix = f" ({latency:.0f} ms)" if latency is not None else ""
    print(f"{_colour('[FAIL]', Colour.RED)} {message}{suffix}")


def log_warn(message: str, latency: float | None = None) -> None:
    suffix = f" ({latency:.0f} ms)" if latency is not None else ""
    print(f"{_colour('[WARN]', Colour.YELLOW)} {message}{suffix}")


def request_json(
    client: httpx.Client,
    method: str,
    path: str,
    **kwargs: Any,
) -> tuple[httpx.Response, dict[str, Any], float]:
    started = time.perf_counter()
    try:
        response = client.request(method, path, **kwargs)
    except httpx.HTTPError as exc:
        latency = (time.perf_counter() - started) * 1000
        raise httpx.HTTPError(
            f"{method} {path} failed after {latency:.0f} ms: {exc}"
        ) from exc
    latency = (time.perf_counter() - started) * 1000
    try:
        payload = response.json()
    except ValueError as exc:
        raise AssertionError(f"response was not valid JSON: {response.text[:200]!r}") from exc
    if not isinstance(payload, dict):
        raise AssertionError(f"response JSON was not an object: {payload!r}")
    return response, payload, latency


def run_check(number: int, title: str, check: Callable[[], Any]) -> bool:
    print(f"\n{_colour(f'Check {number}: {title}', Colour.CYAN)}")
    try:
        check()
    except (AssertionError, httpx.HTTPError) as exc:
        log_fail(str(exc))
        return False
    return True


def main() -> int:
    listing_id: str | None = None
    print(f"Khoj local verification: {BASE_URL}")
    print(f"Session: {SESSION_ID}")
    print("Run command: backend-py\\.venv\\Scripts\\python.exe scripts\\verify_local_system.py")

    with httpx.Client(base_url=BASE_URL, timeout=TIMEOUT_SECONDS) as client:
        def health_check() -> str:
            response, body, latency = request_json(client, "GET", "/health")
            assert response.status_code == 200, f"GET /health returned HTTP {response.status_code}"
            assert body.get("status") == "ok", f"unexpected health status: {body.get('status')!r}"
            assert body.get("database_connected") is True, "database_connected was not true"
            log_pass("GET /health: database connected", latency)
            return "health and database connectivity are healthy"

        if not run_check(1, "Health & database connectivity", health_check):
            return 1

        def session_check() -> str:
            nonlocal listing_id
            response, body, latency = request_json(client, "GET", f"/api/session/{SESSION_ID}")
            assert response.status_code == 200, (
                f"GET /api/session/{SESSION_ID} returned HTTP {response.status_code}"
            )
            listings = body.get("listings")
            assert isinstance(listings, list) and listings, "session contained no listings"
            first = listings[0]
            assert isinstance(first, dict) and first.get("id"), "first listing had no id"
            listing_id = str(first["id"])
            log_pass(f"GET session: found listing {listing_id}", latency)
            return f"retrieved listing_id={listing_id}"

        if not run_check(2, "Session & listing ID retrieval", session_check):
            return 1

        def chat_check() -> str:
            assert listing_id is not None
            payload = {"session_id": SESSION_ID, "listing_id": listing_id}

            in_scope = dict(payload, user_question="What is the actual rent?")
            response, body, latency = request_json(client, "POST", "/api/chat/ask", json=in_scope)
            assert response.status_code == 200, f"in-scope chat returned HTTP {response.status_code}"
            assert body.get("covered") is True, f"in-scope chat was not covered: {body!r}"
            answer = str(body.get("answer", ""))
            assert "30,000" in answer or "38,000" in answer, (
                f"in-scope answer did not mention 30,000 or 38,000: {answer!r}"
            )
            log_pass("in-scope chat: covered rent fact", latency)

            out_of_scope = dict(payload, user_question="Does this area flood in monsoon?")
            response, body, latency = request_json(
                client, "POST", "/api/chat/ask", json=out_of_scope
            )
            assert response.status_code == 200, (
                f"out-of-scope chat returned HTTP {response.status_code}"
            )
            assert body.get("covered") is False, f"out-of-scope chat was covered: {body!r}"
            answer = str(body.get("answer", ""))
            assert "the call didn't cover that" in answer.lower(), (
                f"unexpected uncovered fallback: {answer!r}"
            )
            log_pass("out-of-scope chat: honest fallback returned", latency)
            return "grounded chat checks passed"

        if not run_check(3, 'Real "Ask Khoj" grounded AI chat', chat_check):
            return 1

        def locality_check() -> str:
            response, body, latency = request_json(
                client, "GET", f"/api/session/{SESSION_ID}/locality"
            )
            assert response.status_code == 200, f"locality returned HTTP {response.status_code}"
            context = body.get("context")
            assert isinstance(context, dict), f"locality context was not an object: {context!r}"

            has_summary = bool(str(context.get("summary") or "").strip())
            has_sources = bool(context.get("sources")) and context.get("post_count", 0) > 0
            note = str(context.get("note") or "")
            is_degraded = "not configured" in note.lower() or "no public discussion" in note.lower()
            assert has_summary or has_sources or is_degraded, (
                f"locality had neither a summary nor an expected degraded message: {body!r}"
            )
            if is_degraded:
                log_warn(f"locality context degraded gracefully: {note}", latency)
                return "locality endpoint returned an accepted degraded response"
            log_pass("locality context contains Reddit discussion", latency)
            return "locality endpoint returned summarized context"

        if not run_check(4, "Locality context endpoint", locality_check):
            return 1

    print(f"\n{_colour('[PASS]', Colour.GREEN)} All local verification checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())