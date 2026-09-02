"""Application settings, read once from the environment.

Every knob the system has is declared here with a default, so the set of things
that can be configured is discoverable in one file rather than scattered through
``os.getenv`` calls.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration.

    Values come from the process environment or a local ``.env`` file. Anything
    without a default is genuinely required and the process will refuse to start
    without it, which is preferable to failing on the first request.
    """

    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore", case_sensitive=False
    )

    # --- service ---------------------------------------------------------
    env: Literal["dev", "prod"] = "dev"
    port: int = 8000
    log_level: str = "INFO"

    #: Public https base URL. Twilio dials webhooks here, so localhost cannot
    #: work in production — see ``require_public_https``.
    public_url: str = "http://localhost:8000"

    #: Comma-separated browser origins allowed to call this API with cookies.
    frontend_origins: str = "http://localhost:5173"

    # --- firebase --------------------------------------------------------
    #: Path to a service-account JSON file. Leave empty on Cloud Run / GCE and
    #: the Admin SDK picks up ambient application-default credentials.
    firebase_credentials_file: str = ""
    firebase_project_id: str = ""
    #: Storage bucket for call recordings, e.g. ``my-project.appspot.com``.
    firebase_storage_bucket: str = ""

    # --- llm -------------------------------------------------------------
    llm_provider: Literal["gemini", "openai"] = "gemini"
    gemini_api_key: str = ""
    openai_api_key: str = ""

    #: Cheap, fast model for bulk page extraction.
    extraction_model: str = "gemini-2.0-flash"
    #: Model for preference parsing and honesty evaluation, where nuance matters.
    reasoning_model: str = "gemini-2.0-flash"
    #: Speech-to-speech model driving the phone conversation.
    realtime_model: str = "gpt-4o-realtime-preview-2024-12-17"
    realtime_voice: str = "alloy"

    # --- telephony (CALL-E) ---------------------------------------------
    telephony_provider: Literal["calle", "mock"] = "mock"
    calle_api_key: str = ""
    calle_base_url: str = "https://api.heycall-e.com"
    #: HTTP timeout for a single SDK request, not for the call itself.
    calle_http_timeout: float = 30.0
    #: How long to wait for a call to reach a terminal state, and how often to
    #: poll while waiting.
    calle_timeout_seconds: float = 600.0
    calle_poll_seconds: float = 2.0
    #: Routing and language hints sent with every call.
    call_region: str = "IN"
    call_locale: str = "en-IN"

    # --- scraping --------------------------------------------------------
    max_sites_per_search: int = 5
    max_listings_per_site: int = 25
    scrape_timeout_ms: int = 30_000
    scrape_concurrency: int = 3
    #: Identify the crawler honestly. Do not set this to a browser UA string to
    #: evade bot detection.
    user_agent: str = (
        "KhojBot/0.1 (+https://github.com/manyamharshitha/KHOJ; rental verification)"
    )

    # --- calling policy --------------------------------------------------
    max_concurrent_calls: int = 3
    max_calls_per_session: int = 20
    #: Do not dial the same number twice inside this window, across sessions.
    number_cooldown_days: int = 7
    #: TRAI-friendly windows, IST, as ``HH:MM-HH:MM`` comma separated.
    call_windows_ist: str = "11:00-13:00,17:00-20:00"
    ignore_call_window: bool = False
    call_max_seconds: int = 300

    # --- admin notifications --------------------------------------------
    #: Slack or Discord incoming webhook. Either alone is enough.
    admin_notification_webhook_url: str = ""
    admin_notification_email: str = ""
    resend_api_key: str = ""
    notification_from_email: str = "Khoj <onboarding@resend.dev>"

    # --- auth ------------------------------------------------------------
    auth_required: bool = False
    #: Fixed bearer token accepted as a session, for automated tests only.
    dev_auth_token: str = ""

    @field_validator("public_url")
    @classmethod
    def _strip_trailing_slash(cls, v: str) -> str:
        return v.rstrip("/")

    @property
    def origins(self) -> list[str]:
        """CORS origins as a list."""
        return [o.strip() for o in self.frontend_origins.split(",") if o.strip()]

    @property
    def windows_ist(self) -> list[tuple[int, int]]:
        """Permitted calling windows as ``(start_minute, end_minute)`` pairs.

        A malformed entry discards the whole string and falls back to the safe
        default. A half-parsed list could end up empty, and an empty list means
        every hour is permitted — which is how you dial someone at 3am.
        """
        default = [(11 * 60, 13 * 60), (17 * 60, 20 * 60)]
        out: list[tuple[int, int]] = []
        for part in self.call_windows_ist.split(","):
            try:
                start_s, end_s = part.strip().split("-")
                sh, sm = (int(x) for x in start_s.split(":"))
                eh, em = (int(x) for x in end_s.split(":"))
            except ValueError:
                return default
            start, end = sh * 60 + sm, eh * 60 + em
            if not (0 <= start < end <= 24 * 60):
                return default
            out.append((start, end))
        return out or default

    def require_public_https(self) -> None:
        """Fail loudly before placing calls whose results can never reach us.

        Only needed when a webhook is used. The CALL-E path blocks on
        ``create_and_wait`` and reads the result back over an authenticated
        request, so it works from a laptop with no tunnel — but a webhook URL,
        if one is configured, must still be reachable.
        """
        if not self.public_url.startswith("https://"):
            raise RuntimeError(
                f"PUBLIC_URL must be a public https:// URL for telephony webhooks, "
                f"got {self.public_url!r}. Use a tunnel (cloudflared / ngrok) or a "
                f"deployed host."
            )


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Process-wide settings singleton."""
    return Settings()


settings = get_settings()
