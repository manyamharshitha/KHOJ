"""Shared test fixtures.

The repository tests run against ``mongomock_motor``, not a live server. The
Firebase CLI emulator only speaks the native Firestore API and Firestore
Enterprise speaks the MongoDB wire protocol, so after the migration there was
nothing local left to point the old emulator suite at.

Each test gets its own in-memory database, injected through
``app.core.db.use_database``. That keeps the tests order-independent, which the
previous emulator suite was not — it shared one project and leaned on unique ids
to avoid collisions.
"""

from __future__ import annotations

import inspect

import pytest
from mongomock_motor import AsyncMongoMockClient

from app.core import db as db_module


def _teach_mongomock_to_ignore_newer_pymongo_kwargs() -> None:
    """Let mongomock accept bulk operations built by a newer pymongo.

    pymongo 4.11 added a ``sort`` option to update operations, and
    ``UpdateOne._add_to_bulk`` now passes it unconditionally. mongomock 4.3.0 —
    the newest release — has not caught up, so any ``bulk_write`` raises
    ``add_update() got an unexpected keyword argument 'sort'``.

    The alternative was pinning pymongo below 4.11 in production so that a test
    double could keep up, which is backwards. This drops only keyword arguments
    mongomock genuinely does not accept, and the repositories never pass
    ``sort`` to an update, so nothing meaningful is being discarded — the real
    ``bulk_write`` code path is still what runs under test.
    """
    from mongomock.collection import BulkOperationBuilder

    original = BulkOperationBuilder.add_update
    if getattr(original, "_khoj_shim", False):
        return

    accepted = set(inspect.signature(original).parameters)

    def add_update(self, *args, **kwargs):  # type: ignore[no-untyped-def]
        return original(self, *args, **{k: v for k, v in kwargs.items() if k in accepted})

    add_update._khoj_shim = True  # type: ignore[attr-defined]
    BulkOperationBuilder.add_update = add_update  # type: ignore[method-assign]


_teach_mongomock_to_ignore_newer_pymongo_kwargs()


@pytest.fixture
def mongo_db():
    """A fresh in-memory database, wired into the repositories for one test."""
    client = AsyncMongoMockClient()
    database = client["khoj_test"]
    db_module.use_database(database)
    try:
        yield database
    finally:
        db_module.use_database(None)
