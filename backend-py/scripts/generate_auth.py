"""Capture a signed-in MagicBricks session for the crawler to replay.

Run this by hand, once, on a machine with a screen. It opens a real browser,
waits while you sign in with your own OTP, and writes the resulting cookies and
local storage to ``magicbricks_auth.json``. The crawler loads that file so it
reads the portal as a signed-in user instead of an anonymous one, which is the
difference between a listing with a number to dial and a listing with a "View
Contact" button.

    python scripts/generate_auth.py

The output file is a live credential. Anyone holding it is signed in as you
until the session expires, so it is gitignored and should never be committed,
emailed, or copied to a shared host. Regenerate it rather than share it.

This script does not automate the login itself: no credentials are typed, no
OTP is intercepted, and nothing is done to defeat a bot check. A person signs in
and the session is saved -- which is also why it needs a screen.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

HOME = "https://www.magicbricks.com"

#: Written next to the backend package by default so the crawler finds it
#: without configuration.
DEFAULT_OUT = Path(__file__).resolve().parent.parent / "magicbricks_auth.json"

#: Controls that only a signed-in session sees. Matched as text rather than by
#: class or id, because portals rename their classes far more often than they
#: rename the words a person reads.
_SIGNED_IN = re.compile(
    r"\b(logout|log out|sign out|my magicbricks|my profile|my account|my dashboard)\b",
    re.I,
)

#: Controls that only a signed-out session sees.
_SIGNED_OUT = re.compile(r"\b(login|log in|sign in)\b", re.I)


async def _is_signed_in(page) -> bool:  # type: ignore[no-untyped-def]
    """Best-effort read of whether the session has a logged-in user.

    Positive evidence first: something that only appears once you are in. The
    absence of a "Login" control is weaker evidence -- it is also what a
    half-rendered page looks like -- so it is not treated as a signal on its
    own.
    """
    try:
        if await page.get_by_text(_SIGNED_IN).count() > 0:
            return True
    except Exception:  # noqa: BLE001 - a mid-navigation page is not an error
        pass
    return False


async def _wait_for_login(page, timeout_s: int) -> bool:  # type: ignore[no-untyped-def]
    """Poll for a signed-in state until the deadline. True if it arrived."""
    deadline = asyncio.get_running_loop().time() + timeout_s
    while asyncio.get_running_loop().time() < deadline:
        if await _is_signed_in(page):
            return True
        remaining = int(deadline - asyncio.get_running_loop().time())
        if remaining % 15 == 0 and remaining:
            print(f"  ...still waiting ({remaining}s left)", flush=True)
        await asyncio.sleep(1.0)
    return await _is_signed_in(page)


def _confirm(prompt: str) -> bool:
    try:
        return input(prompt).strip().lower() in {"y", "yes"}
    except EOFError:
        return False


async def capture(out: Path, timeout_s: int, assume_yes: bool) -> int:
    """Open a browser, wait for a manual login, save the session. Exit code."""
    try:
        from playwright.async_api import async_playwright
    except ImportError:
        print(
            "Playwright is not installed. Run:\n"
            "  pip install playwright && python -m playwright install chromium",
            file=sys.stderr,
        )
        return 2

    async with async_playwright() as pw:
        # Headful, and with a real window size: an OTP flow is a thing a person
        # has to see and type into.
        browser = await pw.chromium.launch(headless=False, args=["--start-maximized"])
        context = await browser.new_context(
            viewport={"width": 1440, "height": 900}, locale="en-IN"
        )
        page = await context.new_page()

        try:
            await page.goto(HOME, wait_until="domcontentloaded", timeout=60_000)
        except Exception as exc:  # noqa: BLE001 - report, do not traceback
            print(f"Could not open {HOME}: {exc}", file=sys.stderr)
            await browser.close()
            return 1

        print()
        print("=" * 68)
        print("  A browser window is open on MagicBricks.")
        print()
        print("  1. Click Login / Sign In and sign in with your own number.")
        print("  2. Enter the OTP that arrives on your phone.")
        print("  3. Wait until you are back on a normal page, signed in.")
        print()
        print(f"  This script waits up to {timeout_s}s and saves the session")
        print("  as soon as it sees you are signed in. Leave the window open.")
        print("=" * 68)
        print(flush=True)

        signed_in = await _wait_for_login(page, timeout_s)

        if not signed_in:
            print()
            print("Could not confirm a signed-in session before the deadline.")
            print("Saving anyway would write an anonymous session that the crawler")
            print("would then trust -- it would report 'authenticated' and still")
            print("come back with every number gated, which is worse than no file.")
            if not assume_yes and not _confirm("Save it anyway? [y/N] "):
                await browser.close()
                print("Nothing written. Re-run and allow more time with --timeout.")
                return 1

        out.parent.mkdir(parents=True, exist_ok=True)
        await context.storage_state(path=str(out))

        # A session file with no cookies is a session file that will not work.
        try:
            saved = json.loads(out.read_text(encoding="utf-8"))
            cookies = len(saved.get("cookies", []))
            origins = len(saved.get("origins", []))
        except Exception:  # noqa: BLE001 - the file is written; reporting is a bonus
            cookies = origins = -1

        await browser.close()

        print()
        print(f"Saved {out}")
        if cookies >= 0:
            print(f"  {cookies} cookie(s), {origins} origin(s) with local storage")
        print(f"  captured {datetime.now(timezone.utc).isoformat(timespec='seconds')}")
        print()
        print("This file is a live login. It is gitignored -- keep it that way.")
        print("Sessions expire; re-run this script when the crawler reports that")
        print("its saved session is no longer signed in.")
        return 0 if signed_in else 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument(
        "--out", type=Path, default=DEFAULT_OUT, help=f"output path (default: {DEFAULT_OUT})"
    )
    ap.add_argument(
        "--timeout",
        type=int,
        default=180,
        help="seconds to wait for a manual login (default: 180)",
    )
    ap.add_argument(
        "--yes", action="store_true", help="save even if a login could not be confirmed"
    )
    args = ap.parse_args()
    return asyncio.run(capture(args.out, args.timeout, args.yes))


if __name__ == "__main__":
    raise SystemExit(main())
