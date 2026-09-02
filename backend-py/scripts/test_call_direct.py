"""Dial one number through CALL-E, with nothing else in the way.

No database, no crawler, no LLM, no quota, no cooldown, no calling window — just
the SDK and a phone number. When a call does not arrive, this separates "CALL-E
refused or the network declined it" from "our pipeline never got that far",
which look identical from the outside and are completely different problems.

    python scripts/test_call_direct.py +919398883623
    python scripts/test_call_direct.py +919398883623 --task "Ask if the flat is available."
    python scripts/test_call_direct.py +919398883623 --dry-run

The payload shape mirrors ``app/telephony/calle_dialer.py`` exactly, so a
success here and a failure there points at our pipeline rather than at CALL-E.

Exit code is 0 only when the call completes.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import re
import sys
import time
from typing import Any

# Importable when run as `python scripts/test_call_direct.py` from backend-py.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.config import settings  # noqa: E402

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-7s %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("calltest")

E164 = re.compile(r"^\+[1-9]\d{7,14}$")

#: ``wait_for_result`` stops on exactly these. Lowercase, and the only three.
TERMINAL = {"completed", "failed", "canceled"}

DEFAULT_TASK = (
    "You are calling to check a rental listing. Greet the person, say you are "
    "calling about the flat advertised for rent, and ask two questions: whether "
    "it is still available, and what the total monthly rent including "
    "maintenance is. Keep it under sixty seconds and thank them before hanging "
    "up."
)


def _find(payload: Any, *keys: str) -> Any:
    """First value for any of ``keys``, anywhere in a nested structure.

    The reason a call did not connect is not at a fixed path — it has turned up
    as ``end_reason``, as ``status`` on a nested task, and inside a list of
    attempts. Rather than guess, search.
    """
    if isinstance(payload, dict):
        for key in keys:
            if payload.get(key):
                return payload[key]
        for value in payload.values():
            found = _find(value, *keys)
            if found:
                return found
    elif isinstance(payload, list):
        for item in payload:
            found = _find(item, *keys)
            if found:
                return found
    return None


def main() -> int:
    parser = argparse.ArgumentParser(description="Place one real CALL-E call.")
    parser.add_argument("phone", help="Destination in E.164, e.g. +919398883623")
    parser.add_argument("--task", default=DEFAULT_TASK, help="What the agent should do.")
    parser.add_argument(
        "--timeout",
        type=float,
        default=settings.calle_timeout_seconds,
        help="Seconds to wait for the call to finish.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Validate configuration and print the payload without dialling.",
    )
    parser.add_argument(
        "--full",
        action="store_true",
        help=(
            "Use the production call script and result schema instead of the "
            "two-question default — the same 15 questions a real verification "
            "asks. Needs a listing, so a representative one is synthesised."
        ),
    )
    args = parser.parse_args()

    # --- preflight ------------------------------------------------------
    if not E164.match(args.phone):
        log.error(
            "%r is not E.164. It must be '+', country code, then digits — no "
            "spaces, dashes or leading zero. For India: +91 then 10 digits.",
            args.phone,
        )
        return 2

    if not settings.calle_api_key:
        log.error("CALLE_API_KEY is not set. Nothing can be dialled without it.")
        return 2

    key = settings.calle_api_key
    log.info("api key    : %s…%s (%d chars)", key[:6], key[-4:], len(key))
    log.info("base url   : %s", settings.calle_base_url)
    log.info("region     : %s / %s", settings.call_region, settings.call_locale)

    try:
        from calle import CalleClient
    except ImportError:
        log.error("The calle-ai SDK is not installed. Run: pip install calle-ai")
        return 2

    # Same shape the production dialer uses. `recipient` is an object holding a
    # list of numbers — there is no flat `recipient_phone_number` parameter, and
    # passing one is a TypeError from `create()`, not an API error.
    payload: dict[str, Any] = {
        "task": f"Call {args.phone}. {args.task}",
        "recipient": {
            "phones": [args.phone],
            "region": settings.call_region,
            "locale": settings.call_locale,
        },
        "metadata": {"source": "test_call_direct"},
        "idempotency_key": f"direct-test-{int(time.time())}",
        "interval_seconds": settings.calle_poll_seconds,
        "timeout_seconds": args.timeout,
    }

    if args.full:
        # The point of --full is that nothing here is bespoke: it is the exact
        # task and schema a real verification uses, so what you hear on the
        # phone is what the pipeline would ask.
        from app.models import Listing, SearchCriteria
        from app.telephony.calle_dialer import verification_schema
        from app.telephony.persona import build_task

        listing = Listing(
            id="test-listing",
            session_id="test-session",
            source_site="Pasted content",
            title="2BHK in Kondapur",
            locality="Kondapur",
            bedrooms=2,
            property_type="2BHK",
            rent=22000,
            maintenance=2000,
            deposit=60000,
            age_years=4.0,
            furnishing="semi-furnished",
            contact_number=args.phone,
        )
        criteria = SearchCriteria(
            city="Hyderabad",
            localities=["Kondapur"],
            bedrooms=2,
            max_total_monthly=25000,
            furnishing="semi-furnished",
            must_haves=["family only"],
        )
        payload["task"] = build_task(listing, criteria, "2BHK in Kondapur under 25000")
        payload["recipient_result_schema"] = verification_schema(criteria)
        log.info(
            "full mode  : production script (%d chars) and result schema (%d fields)",
            len(payload["task"]),
            len(payload["recipient_result_schema"]["properties"]),
        )

    log.info("payload    :\n%s", json.dumps(payload, indent=2))

    if args.dry_run:
        log.info("dry run — nothing dialled.")
        return 0

    # --- dial -----------------------------------------------------------
    client = CalleClient(api_key=key)
    log.info("dialling %s — this blocks until the call ends…", args.phone)
    started = time.monotonic()

    try:
        result: dict[str, Any] = client.calls.create_and_wait(**payload)
    except Exception:
        # The whole point of this script: the SDK's own error, unswallowed.
        log.exception("CALL-E raised. The traceback above is the provider's own.")
        log.error(
            "Common causes: invalid_api_key (wrong or revoked), "
            "insufficient_balance (no credits), unsupported_destination "
            "(region not enabled on your account)."
        )
        return 1

    elapsed = time.monotonic() - started

    # --- report ---------------------------------------------------------
    # create_and_wait returns a dict, not an object — attribute access would
    # raise here rather than read the status.
    call_id = result.get("id") or "<none>"
    status = str(result.get("status") or "<unknown>").lower()

    log.info("-" * 62)
    log.info("call id    : %s", call_id)
    log.info("status     : %s", status)
    log.info("duration   : %.1fs", elapsed)

    reason = _find(result, "end_reason", "ended_reason", "disconnect_reason", "error")
    if reason:
        log.info("reason     : %s", str(reason)[:300])

    transcript = result.get("transcript") or result.get("messages") or []
    if transcript:
        log.info("transcript : %d turn(s)", len(transcript))
        for turn in transcript:
            if isinstance(turn, dict):
                who = turn.get("role") or turn.get("speaker") or "?"
                text = turn.get("content") or turn.get("text") or ""
                log.info("   %-6s %s", who, str(text)[:160])
    else:
        log.info("transcript : empty — nobody spoke, so it was never answered")

    # Per-call events say far more about *why* than the final status does.
    try:
        events = client.calls.list_events(str(call_id))
        items = events.get("events") or events.get("data") or []
        if items:
            log.info("events     : %d", len(items))
            for ev in items[:15]:
                if isinstance(ev, dict):
                    log.info(
                        "   %-22s %s",
                        ev.get("type") or ev.get("name") or "?",
                        json.dumps(
                            {k: v for k, v in ev.items() if k not in ("type", "name")}
                        )[:140],
                    )
    except Exception as exc:  # noqa: BLE001 - diagnostics must not mask the result
        log.info("events     : unavailable (%s)", exc)

    log.info("-" * 62)
    log.info("full result:\n%s", json.dumps(result, indent=2, default=str)[:3000])

    if status == "completed":
        return 0

    declined = str(reason or "").lower()
    if any(word in declined for word in ("declin", "no_answer", "busy", "reject", "hangup")):
        log.error(
            "The network reached the handset and it refused the call. That is a "
            "phone-side outcome, not a bug in this code: check the number is not "
            "on DND, that silent mode is off, and that the carrier is not "
            "filtering unknown VoIP callers — Indian networks do this "
            "aggressively. Try a second handset on a different network."
        )
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
