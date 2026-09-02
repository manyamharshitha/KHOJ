"""Shared test fixtures.

The Firestore async client holds a gRPC channel bound to the event loop it was
created on, and ``get_db`` caches it for the life of the process. That is right
in production, where a process has exactly one loop.

The tests therefore run on a **single session-wide loop** (configured in
``pyproject.toml``) rather than clearing the cache between tests. Clearing it
abandons a live gRPC channel; the channel is then collected with work still
outstanding, which surfaces as ``InterceptedCall.__del__`` errors and, on the
larger fixtures, a hang. Matching production's one-loop model avoids the problem
instead of papering over it.
"""

from __future__ import annotations
