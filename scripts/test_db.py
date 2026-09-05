"""Test the Firestore Enterprise MongoDB connection asynchronously.

Run from the repository root with:

    backend-py\\.venv\\Scripts\\python.exe scripts\\test_db.py
"""

from __future__ import annotations

import asyncio
import os
from pathlib import Path

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo.errors import ConfigurationError, OperationFailure, PyMongoError

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / "backend-py" / ".env")


async def main() -> int:
    """Ping the configured database and report the exact failure category."""
    uri = os.getenv("FIRESTORE_ENTERPRISE_URI", "").strip()
    if not uri:
        print("[FAIL] FIRESTORE_ENTERPRISE_URI is not configured")
        return 1

    client = AsyncIOMotorClient(
        uri,
        serverSelectionTimeoutMS=3000,
        connectTimeoutMS=3000,
    )
    try:
        await client.admin.command("ping")
    except (ConfigurationError, OperationFailure, PyMongoError) as exc:
        print(f"[FAIL] {type(exc).__name__}: {exc}")
        return 1
    except Exception as exc:  # noqa: BLE001 - print unexpected driver errors exactly
        print(f"[FAIL] {type(exc).__name__}: {exc}")
        return 1
    else:
        print("[SUCCESS] Connected to database!")
        return 0
    finally:
        client.close()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
