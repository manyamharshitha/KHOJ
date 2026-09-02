"""Document id generation.

Its own module because the pure logic — extraction, honesty analysis — needs to
mint ids without importing the database. Keeping this in ``repositories`` meant
``app.llm.extractor`` pulled in the whole Firestore client just to name a
listing, which made those modules impossible to test or reason about offline.
"""

from __future__ import annotations

import secrets
from datetime import datetime, timezone


def new_id(prefix: str) -> str:
    """Collision-resistant, roughly time-ordered document id.

    The millisecond prefix keeps documents in creation order in the Firebase
    console, which makes following a live run far easier than random ids do.
    """
    stamp = int(datetime.now(timezone.utc).timestamp() * 1000)
    return f"{prefix}_{stamp:x}{secrets.token_hex(4)}"
