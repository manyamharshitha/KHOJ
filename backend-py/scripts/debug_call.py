"""What state the call rows are actually stuck in.

Reads the most recent calls straight out of the database as **raw documents**,
not as ``CallLog`` models. That is deliberate: a row whose stored status no
longer validates against the model is exactly the sort of row worth seeing, and
model validation would raise instead of showing it to you.

    python scripts/debug_call.py
    python scripts/debug_call.py --limit 10
    python scripts/debug_call.py --session ses_abc123
    python scripts/debug_call.py --stuck

``--stuck`` lists only rows sitting in DIALING or IN_PROGRESS, which is the
signature of a background task that started a call and never came back: the
worker crashed, the SDK blocked forever, or the process was restarted mid-dial.

Reads only. Nothing here writes, dials or spends anything.
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
from datetime import datetime, timezone
from typing import Any

# Importable when run as `python scripts/debug_call.py` from backend-py.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.config import settings  # noqa: E402
from app.core.db import connect, disconnect  # noqa: E402

STUCK = ("dialing", "in_progress")


def _age(value: Any) -> str:
    """How long ago, in words. A row stuck for hours is the whole story."""
    if not isinstance(value, datetime):
        return "—"
    moment = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    seconds = (datetime.now(timezone.utc) - moment).total_seconds()
    if seconds < 90:
        return f"{int(seconds)}s ago"
    if seconds < 5400:
        return f"{int(seconds / 60)}m ago"
    if seconds < 172800:
        return f"{int(seconds / 3600)}h ago"
    return f"{int(seconds / 86400)}d ago"


def _stamp(value: Any) -> str:
    return value.isoformat(timespec="seconds") if isinstance(value, datetime) else "—"


def _print_config() -> None:
    key = settings.calle_api_key
    print("=" * 72)
    print("CONFIGURATION")
    print("=" * 72)
    print(f"  telephony_provider     : {settings.telephony_provider}")
    print(f"  calle_api_key set      : {bool(key)}" + (f"  ({len(key)} chars)" if key else ""))
    print(f"  calle_base_url         : {settings.calle_base_url}")
    print(f"  calle_http_timeout     : {settings.calle_http_timeout}s")
    print(f"  calle_timeout_seconds  : {settings.calle_timeout_seconds}s")
    print(f"  bypass_call_window     : {settings.bypass_call_window}")
    print(f"  ignore_call_window     : {settings.ignore_call_window}")
    print(f"  number_cooldown_days   : {settings.number_cooldown_days}")
    print(f"  max_calls_per_day      : {settings.max_calls_per_day}")
    print(f"  free_lifetime_calls    : {settings.free_plan_lifetime_calls}")
    print(f"  database_name          : {settings.database_name}")

    if settings.telephony_provider != "calle":
        print()
        print("  >> TELEPHONY_PROVIDER is not 'calle'. The mock dialer is in use:")
        print("     it fabricates a transcript, reports COMPLETED, and never")
        print("     touches the telephone network. No phone will ring.")
    elif not key:
        print()
        print("  >> TELEPHONY_PROVIDER is 'calle' but CALLE_API_KEY is empty.")
        print("     Every call will fail at dialer construction.")
    print()


async def main() -> int:
    parser = argparse.ArgumentParser(description="Inspect recent call rows.")
    parser.add_argument("--limit", type=int, default=3, help="How many calls to show.")
    parser.add_argument("--session", help="Only calls for this session id.")
    parser.add_argument(
        "--stuck", action="store_true", help="Only rows in DIALING or IN_PROGRESS."
    )
    args = parser.parse_args()

    _print_config()

    try:
        db = await connect()
    except Exception as exc:  # noqa: BLE001 - the reason is the output
        print(f"Could not reach the database: {type(exc).__name__}: {exc}")
        return 2

    try:
        query: dict[str, Any] = {}
        if args.session:
            query["session_id"] = args.session
        if args.stuck:
            query["call_status"] = {"$in": list(STUCK)}

        rows = (
            await db["calls"]
            .find(query)
            .sort("created_at", -1)
            .limit(args.limit)
            .to_list(length=args.limit)
        )

        print("=" * 72)
        print(f"CALLS  ({len(rows)} row(s), newest first)")
        print("=" * 72)

        if not rows:
            print("  No call rows matched.")
            print()
            print("  No row at all means the pipeline never got as far as reserving")
            print("  one — the request was refused before dialling (quota, rate")
            print("  limit, no dialable listing), or it never reached the backend.")
            return 0

        for row in rows:
            status = str(row.get("call_status") or "—")
            created = row.get("created_at")
            print()
            print(f"  _id            : {row.get('_id')}")
            print(f"  call_status    : {status.upper()}")
            print(f"  error          : {row.get('error') or '— (none recorded)'}")
            print(f"  phone_dialed   : {row.get('phone_dialed') or '—'}")
            print(f"  provider_id    : {row.get('provider_call_id') or '— (never reached CALL-E)'}")
            print(f"  session_id     : {row.get('session_id')}")
            print(f"  listing_id     : {row.get('listing_id')}")
            print(f"  created_at     : {_stamp(created)}   ({_age(created)})")
            print(f"  started_at     : {_stamp(row.get('started_at'))}")
            print(f"  ended_at       : {_stamp(row.get('ended_at'))}")
            print(f"  duration_sec   : {row.get('duration_sec')}")
            print(f"  transcript     : {len(row.get('transcript') or [])} turn(s)")

            if status in STUCK and not row.get("ended_at"):
                print()
                print(f"  >> STUCK in {status.upper()} with no ended_at, {_age(created)}.")
                print("     The row was reserved and the worker never wrote a result.")
                print("     Either the dialer is still blocked inside the SDK, or the")
                print("     process died mid-call. Check the server log for this id.")
            if status == "blocked":
                print()
                print("     Refused by the per-number cooldown before dialling.")
                print(f"     Same number within {settings.number_cooldown_days} days.")
                print("     Set BYPASS_CALL_WINDOW=true to dial it again.")
            if status == "failed" and not row.get("provider_call_id"):
                print()
                print("     Failed with no provider id — it never reached CALL-E.")
                print("     The reason is in `error` above.")

        print()
        return 0
    finally:
        await disconnect()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
