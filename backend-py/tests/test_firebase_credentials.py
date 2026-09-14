"""Sign-in survives a credentials path that points somewhere else.

The live service had FIREBASE_CREDENTIALS_FILE set to a laptop path, quote marks
included, while the key itself was mounted as a Render Secret File. Firebase
initialisation raised on the missing path, every token verification failed, and
optional sign-in turned each signed-in customer into an anonymous one — so every
search was saved without an owner and history showed nothing.
"""

from __future__ import annotations

import firebase_admin
import pytest

from app import firebase
from app.config import settings

KEY_NAME = "khoj-cd80b-firebase-adminsdk-fbsvc-49ffe83b02.json"


def test_a_quoted_laptop_path_finds_the_mounted_secret(
    tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The exact value from the live logs."""
    secret = tmp_path / KEY_NAME
    secret.write_text("{}")
    monkeypatch.setattr(firebase, "SECRET_DIRS", (tmp_path,))
    # A folder that exists on no machine: on the laptop that wrote this, the
    # real key sits in Downloads, and a path that exists is rightly used as is.
    monkeypatch.setattr(
        settings, "firebase_credentials_file", f'"C:\\Users\\nobody-here\\Downloads\\{KEY_NAME}"'
    )

    assert firebase.credentials_path() == secret
    assert firebase.has_service_credential()


def test_a_path_that_exists_is_used_as_given(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    key = tmp_path / "local-key.json"
    key.write_text("{}")
    monkeypatch.setattr(firebase, "SECRET_DIRS", ())
    monkeypatch.setattr(settings, "firebase_credentials_file", str(key))

    assert firebase.credentials_path() == key


def test_the_conventional_secret_name_is_found(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    """render.yaml names the mounted file serviceAccountKey.json."""
    secret = tmp_path / "serviceAccountKey.json"
    secret.write_text("{}")
    monkeypatch.setattr(firebase, "SECRET_DIRS", (tmp_path,))
    monkeypatch.setattr(settings, "firebase_credentials_file", "C:\\somewhere\\else.json")

    assert firebase.credentials_path() == secret


def test_no_file_anywhere_still_initialises_instead_of_raising(
    tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Raising here is what turned every signed-in request anonymous."""
    monkeypatch.setattr(firebase, "SECRET_DIRS", (tmp_path,))
    monkeypatch.setattr(settings, "firebase_credentials_file", "/nowhere/key.json")
    monkeypatch.setattr(firebase_admin, "_apps", {})

    calls: list[tuple[tuple, dict]] = []

    def fake_initialize(*args, **kwargs):
        calls.append((args, kwargs))
        return "app"

    monkeypatch.setattr(firebase_admin, "initialize_app", fake_initialize)

    firebase._app.cache_clear()
    try:
        assert firebase._app() == "app"
    finally:
        firebase._app.cache_clear()

    assert calls, "Firebase was not initialised"
    assert calls[0][0] == (), "it should initialise without a certificate, not with one"
    assert not firebase.has_service_credential(), "no file means no revocation check"
