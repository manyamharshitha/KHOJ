#!/usr/bin/env python
"""Why stages 4 and 5 fail: import, config, network, auth, quota, or data.

    python scripts/diagnose_stages_4_5.py
    python scripts/diagnose_stages_4_5.py --use-llm     # spends 1 Gemini call

Works down the layers in order. A failure at one layer makes every layer below
it meaningless, so the FIRST failure is the cause and everything after it is
noise. Each check says which kind of problem it is — import, config, network,
auth, quota, or logic — because those need completely different fixes.

Only the single check marked LLM costs anything, and only with --use-llm.
"""

from __future__ import annotations

import argparse
import asyncio
import os
import socket
import sys
import traceback
from pathlib import Path
from urllib.parse import urlsplit

# Running as `python scripts/x.py` puts scripts/ on the path but not the project
# root, so `import app` fails. This is also why stage 4's fallback could not
# import `scripts.extract_listings_http`.
ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

FAILURES: list[str] = []


def head(text: str) -> None:
    print(f"\n{text}\n" + "-" * 76)


def ok(what: str, detail: str = "") -> None:
    print(f"  [ PASS ]  {what:<38} {detail}")


def bad(kind: str, what: str, detail: str) -> None:
    print(f"  [ FAIL ]  {what:<38} {kind}: {detail}")
    FAILURES.append(f"{what} — {kind}: {detail}")


def skip(what: str, detail: str) -> None:
    print(f"  [ SKIP ]  {what:<38} {detail}")


# ===========================================================================
# STAGE 4
# ===========================================================================


def check_imports() -> bool:
    """IMPORT errors. Nothing else can be tested until these pass."""
    head("STAGE 4 — imports")
    good = True

    for name in ("app.config", "app.llm.client", "app.llm.extractor",
                 "app.scraping.http_reader", "app.scraping.crawler"):
        try:
            __import__(name)
            ok(name)
        except SyntaxError as exc:
            bad("SYNTAX", name, f"line {exc.lineno}: {exc.msg}")
            good = False
        except Exception as exc:
            bad("IMPORT", name, f"{type(exc).__name__}: {exc}")
            good = False

    # The specific import stage 4's no-LLM path needs.
    try:
        from scripts.extract_listings_http import parse  # noqa: F401
        ok("scripts.extract_listings_http")
    except Exception as exc:
        bad("IMPORT", "scripts.extract_listings_http",
            f"{type(exc).__name__}: {exc}  "
            f"(add an empty scripts/__init__.py, or run from {ROOT})")
        good = False

    return good


def check_llm_config() -> bool:
    """CONFIG. Is there a key at all, and does the app see it?"""
    head("STAGE 4 — LLM configuration")
    try:
        from app.config import settings
        from app.llm.client import llm_available
    except Exception as exc:
        bad("IMPORT", "config", str(exc))
        return False

    raw_key = os.environ.get("GEMINI_API_KEY") or getattr(settings, "gemini_api_key", "")
    if not raw_key:
        bad("CONFIG", "GEMINI_API_KEY",
            "not set in the environment or .env — extraction cannot run")
        return False
    ok("GEMINI_API_KEY", f"present ({len(str(raw_key))} chars)")

    ok("provider", settings.llm_provider)
    ok("model", settings.extraction_model)
    ok("max output tokens", str(getattr(settings, "extraction_max_tokens", "8192 (default)")))

    if not llm_available():
        bad("CONFIG", "llm_available()", "returns False despite a key being present")
        return False
    ok("llm_available()", "True")
    return True


async def check_free_parse(locality: str, city: str) -> int:
    """LOGIC. Does the page parse without an LLM? Costs nothing."""
    head("STAGE 4 — parsing without an LLM (free)")
    try:
        from scripts.extract_listings_http import scrape
    except Exception as exc:
        bad("IMPORT", "scrape", str(exc))
        return 0

    try:
        listings = await scrape("nobroker", locality, city)
    except Exception as exc:
        bad("LOGIC", "regex parse", f"{type(exc).__name__}: {exc}")
        traceback.print_exc()
        return 0

    if not listings:
        bad("LOGIC", "regex parse",
            "0 listings from a live page — the page structure probably changed")
        return 0

    ok("regex parse", f"{len(listings)} listing(s), "
                      f"{sum(1 for x in listings if x.photo)} with photos")
    return len(listings)


async def check_llm_call(use_llm: bool) -> bool:
    """QUOTA / API. One real call, only when asked for."""
    head("STAGE 4 — Gemini (metered)")
    if not use_llm:
        skip("live Gemini call", "pass --use-llm to spend one request")
        return True

    try:
        from app.llm.client import LLMError, LLMUnavailable, complete_json
    except Exception as exc:
        bad("IMPORT", "llm client", str(exc))
        return False

    try:
        # The smallest possible request: proves the key, the model name, the
        # network and the quota in one call.
        await complete_json(
            system="Reply with JSON.",
            user='Return exactly {"ok": true}',
            schema={"type": "object", "properties": {"ok": {"type": "boolean"}},
                    "required": ["ok"]},
            max_tokens=64,
        )
        ok("live Gemini call", "the API answered")
        return True

    except LLMUnavailable as exc:
        bad("CONFIG", "Gemini", f"no usable credentials: {exc}")
    except LLMError as exc:
        text = str(exc)
        if "429" in text or "RESOURCE_EXHAUSTED" in text:
            bad("QUOTA", "Gemini", "daily free-tier limit reached (20/day). "
                                   "Resets midnight Pacific, or enable billing.")
        elif "404" in text or "not found" in text.lower():
            bad("CONFIG", "Gemini", "the model name was rejected — check "
                                    "EXTRACTION_MODEL")
        elif "cut off" in text:
            bad("LOGIC", "Gemini", f"truncated: {text}")
        else:
            bad("API", "Gemini", text[:160])
    except Exception as exc:
        bad("NETWORK", "Gemini", f"{type(exc).__name__}: {str(exc)[:160]}")
    return False


# ===========================================================================
# STAGE 5
# ===========================================================================


def check_db_config() -> str | None:
    """CONFIG. Is there a connection string, and is it shaped like one?"""
    head("STAGE 5 — database configuration")
    try:
        from app.config import settings
    except Exception as exc:
        bad("IMPORT", "config", str(exc))
        return None

    uri = getattr(settings, "firestore_enterprise_uri", "") or ""
    if not uri:
        bad("CONFIG", "FIRESTORE_ENTERPRISE_URI", "empty — nothing to connect to")
        return None

    if not uri.startswith(("mongodb://", "mongodb+srv://")):
        bad("CONFIG", "FIRESTORE_ENTERPRISE_URI",
            f"does not look like a Mongo URI (starts {uri[:12]!r})")
        return None

    # Never print the password.
    parts = urlsplit(uri)
    host = parts.hostname or "?"
    user = parts.username or "(none)"
    ok("connection string", f"{parts.scheme}://{user}:***@{host}")
    ok("database name", settings.database_name)
    return uri


def check_dns(uri: str) -> bool:
    """NETWORK. mongodb+srv needs an SRV lookup, which some networks block."""
    head("STAGE 5 — DNS")
    host = urlsplit(uri).hostname
    if not host:
        bad("CONFIG", "host", "no hostname in the URI")
        return False

    if uri.startswith("mongodb+srv://"):
        try:
            import dns.resolver  # pymongo ships this

            answers = dns.resolver.resolve(f"_mongodb._tcp.{host}", "SRV")
            ok("SRV record", f"{len(list(answers))} node(s) found")
        except Exception as exc:
            bad("NETWORK", "SRV lookup",
                f"{type(exc).__name__}: {exc} — this network may block SRV DNS")
            return False

    try:
        socket.gethostbyname(host)
        ok("hostname resolves", host)
        return True
    except socket.gaierror as exc:
        bad("NETWORK", "DNS", f"cannot resolve {host}: {exc}")
        return False


async def check_db_connect() -> bool:
    """AUTH / NETWORK. The real connection, with the error kinds separated."""
    head("STAGE 5 — connecting")
    try:
        from app.core.db import connect, disconnect, ping_diagnostic
    except Exception as exc:
        bad("IMPORT", "app.core.db", str(exc))
        return False

    try:
        await connect()
    except Exception as exc:
        text = str(exc).lower()
        if "auth" in text or "credential" in text or "password" in text:
            bad("AUTH", "connect", "credentials rejected — the password may have "
                                   "been rotated without updating .env")
        elif "timed out" in text or "timeout" in text:
            bad("NETWORK", "connect",
                "timed out — your IP is probably not on the Atlas allowlist, "
                "or port 27017 is blocked on this network")
        elif "ssl" in text or "tls" in text or "certificate" in text:
            bad("NETWORK", "connect", f"TLS problem: {str(exc)[:120]}")
        else:
            bad("NETWORK", "connect", f"{type(exc).__name__}: {str(exc)[:140]}")
        return False

    alive, error = await ping_diagnostic()
    if not alive:
        bad("NETWORK", "ping", error or "the server did not answer")
        await disconnect()
        return False

    ok("connected and ping answered")

    try:
        from app.repositories import LISTINGS, SESSIONS
        from app.core.db import get_db

        db = get_db()
        ok("sessions collection", f"{await db[SESSIONS].count_documents({})} document(s)")
        ok("listings collection", f"{await db[LISTINGS].count_documents({})} document(s)")
    except Exception as exc:
        bad("LOGIC", "reading collections", f"{type(exc).__name__}: {exc}")
        await disconnect()
        return False

    await disconnect()
    return True


# ===========================================================================


async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("locality", nargs="?", default="yelahanka")
    ap.add_argument("city", nargs="?", default="bangalore")
    ap.add_argument("--use-llm", action="store_true",
                    help="make one real Gemini call to test key, model and quota")
    args = ap.parse_args()

    if not check_imports():
        print("\nStop here. Nothing below can be trusted until imports work.\n")
        return 1

    check_llm_config()
    await check_free_parse(args.locality, args.city)
    await check_llm_call(args.use_llm)

    uri = check_db_config()
    if uri and check_dns(uri):
        await check_db_connect()

    head("SUMMARY")
    if not FAILURES:
        print("  Everything passed.\n")
        return 0
    for i, line in enumerate(FAILURES, 1):
        print(f"  {i}. {line}")
    print(f"\n  First failure is the one to fix: {FAILURES[0]}\n")
    return 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))