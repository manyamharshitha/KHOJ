"""Ask CALL-E why one specific call failed.

Our own ``error`` field records what the SDK handed back, which for a call that
was accepted and then failed is only ``status=FAILED`` — true, and useless. The
provider knows more than it returns on the task: per-call events carry the leg
state, the carrier response and the reason the handset was never reached.

Takes the ``provider_call_id`` shown by ``scripts/debug_call.py``:

    python scripts/inspect_calle_call.py call_-W5EBCDh1hJ6VZ5381OdLw

Reads only. Places no call and spends nothing.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Any

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.config import settings  # noqa: E402

#: SIP response codes, which is what ``failure_code`` carries when the leg
#: reached a carrier at all.
#:
#: Read these and not the ``summary``. CALL-E's summary is model-written prose
#: that guesses at a cause — "the recipient may be busy or unavailable" is
#: emitted for a 404, which is not busy and never rang. Matching on that text
#: sent a diagnosis in exactly the wrong direction once already.
SIP_CODES: dict[str, tuple[str, bool]] = {
    # code: (what it means, is it the handset's doing)
    # Plain ASCII: this prints to a Windows console under cp1252, where an em
    # dash renders as a replacement character and makes the verdict look broken.
    "404": (
        "Not Found. The carrier had no route to this number. The leg was "
        "rejected instantly, so nothing rang. On an Indian mobile this is "
        "normally the provider account lacking +91 mobile termination, not "
        "anything about the handset.",
        False,
    ),
    "403": ("Forbidden. The carrier refused the route or the caller id.", False),
    "408": ("Request Timeout. It rang and nobody picked up.", True),
    "480": ("Temporarily Unavailable. Switched off, or out of coverage.", True),
    "486": ("Busy Here. The line was genuinely engaged.", True),
    "487": ("Request Terminated. Cancelled before answer.", False),
    "503": ("Service Unavailable. The carrier or trunk was down.", False),
    "603": ("Decline. The handset actively rejected the call.", True),
}


def _duration(attempt: dict[str, Any]) -> str:
    """How long the leg lasted. Zero means it never rang."""
    start, end = attempt.get("started_at"), attempt.get("completed_at")
    if not start or not end:
        return "-"
    if str(start) == str(end):
        return "0s - rejected instantly, the handset never rang"
    return f"{start} -> {end}"


def _walk(payload: Any, *keys: str) -> list[tuple[str, Any]]:
    """Every value for any of ``keys``, anywhere in a nested structure.

    The failure reason has no fixed path — it has appeared as `end_reason`, as
    `failure_message` on an attempt, and inside a list of events. Collect them
    all rather than guessing which shape this response uses.
    """
    found: list[tuple[str, Any]] = []
    if isinstance(payload, dict):
        for key in keys:
            if payload.get(key):
                found.append((key, payload[key]))
        for value in payload.values():
            found.extend(_walk(value, *keys))
    elif isinstance(payload, list):
        for item in payload:
            found.extend(_walk(item, *keys))
    return found


def main() -> int:
    parser = argparse.ArgumentParser(description="Inspect one CALL-E call.")
    parser.add_argument("call_id", help="provider_call_id, e.g. call_-W5EBC...")
    parser.add_argument("--raw", action="store_true", help="Dump the full JSON.")
    args = parser.parse_args()

    if not settings.calle_api_key:
        print("CALLE_API_KEY is not set — nothing to ask.")
        return 2

    try:
        from calle import CalleClient
    except ImportError:
        print("The calle-ai SDK is not installed. Run: pip install calle-ai")
        return 2

    client = CalleClient(
        api_key=settings.calle_api_key,
        base_url=settings.calle_base_url,
        timeout=settings.calle_http_timeout,
    )

    print("=" * 72)
    print(f"CALL-E CALL  {args.call_id}")
    print("=" * 72)

    try:
        call: dict[str, Any] = client.calls.get(args.call_id)
    except Exception as exc:  # noqa: BLE001 - the provider's own error is the output
        print(f"  Could not fetch the call: {type(exc).__name__}: {exc}")
        return 1

    print(f"  status         : {call.get('status')}")
    print(f"  created_at     : {call.get('created_at')}")
    print(f"  completed_at   : {call.get('completed_at')}")

    recipients = call.get("recipients") or []
    for index, recipient in enumerate(recipients):
        print()
        print(f"  recipient[{index}]   : {recipient.get('phones') or recipient.get('phone')}")
        print(f"    status       : {recipient.get('status')}")
        print(f"    summary      : {recipient.get('summary') or '—'}")
        for a_index, attempt in enumerate(recipient.get("attempts") or []):
            print(f"    attempt[{a_index}]   :")
            print(f"      status         : {attempt.get('status')}")
            code = str(attempt.get("failure_code") or "")
            known = SIP_CODES.get(code)
            gloss = f"  ({known[0].split('.')[0]})" if known else ""
            print(f"      failure_code   : {code or '-'}{gloss}")
            print(f"      failure_message: {attempt.get('failure_message') or '-'}")
            print(f"      ring time      : {_duration(attempt)}")
            print(f"      turns          : {len(attempt.get('transcript_turns') or [])}")

    if not recipients:
        print()
        print("  No recipient on the task at all — CALL-E accepted it and never")
        print("  built a leg. That points at the payload, not at the handset.")

    reasons = _walk(
        call, "end_reason", "ended_reason", "disconnect_reason", "failure_code",
        "failure_message", "error", "sip_code", "sip_reason",
    )
    if reasons:
        print()
        print("  REASONS FOUND")
        seen: set[str] = set()
        for key, value in reasons:
            line = f"{key}={value}"
            if line in seen:
                continue
            seen.add(line)
            print(f"    {key:18} {str(value)[:200]}")

    try:
        events = client.calls.list_events(args.call_id)
        items = events.get("events") or events.get("data") or []
        print()
        print(f"  EVENTS ({len(items)})")
        for event in items[:40]:
            if not isinstance(event, dict):
                continue
            name = event.get("type") or event.get("name") or "?"
            rest = {k: v for k, v in event.items() if k not in ("type", "name")}
            print(f"    {name:24} {json.dumps(rest, default=str)[:170]}")
    except Exception as exc:  # noqa: BLE001 - diagnostics must not mask the result
        print(f"  events         : unavailable ({type(exc).__name__}: {exc})")

    # The verdict comes from the structured code on the attempt, never from the
    # summary prose. Only fall back to guessing when there is no code at all.
    codes = [str(v) for k, v in reasons if k == "failure_code" and str(v) in SIP_CODES]

    print()
    print("=" * 72)
    if codes:
        code = codes[0]
        meaning, handset_side = SIP_CODES[code]
        print(f"  SIP {code}: {meaning}")
        print()
        if handset_side:
            print("  This is the handset's doing. The call was routed and delivered,")
            print("  and the phone declined it. Nothing in this codebase changes")
            print("  that — check DND, silent mode, and try another handset.")
        else:
            print("  This is not the handset. The call was never delivered, so no")
            print("  amount of answering it would have helped. Quote this call id")
            print("  to CALL-E support and ask whether the destination country and")
            print("  number type are enabled for termination on the account.")
    else:
        print("  No recognised SIP code on the attempt.")
        print()
        print("  Do not read the `summary` above as a diagnosis — it is written by")
        print("  a model after the fact and guesses at causes it was not told.")
        print("  If there is no recipient or attempt either, CALL-E accepted the")
        print("  task and never built a leg: raise that with them, quoting the id.")

    if args.raw:
        print()
        print(json.dumps(call, indent=2, default=str)[:6000])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
