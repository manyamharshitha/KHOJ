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

    # --- locality context (Reddit) ---------------------------------------
    #: Reddit credentials. Register a "script" app at
    #: https://www.reddit.com/prefs/apps to get these.
    #:
    #: Required, not optional: appending ".json" to a search URL now returns
    #: HTTP 403 and an HTML page. Unauthenticated reads were closed off, so the
    #: OAuth client-credentials flow is the only route that still works.
    #: Without them, locality context degrades to "not configured" and the rest
    #: of the product is unaffected.
    reddit_client_id: str = ""
    reddit_client_secret: str = ""
    reddit_user_agent: str = "khoj-locality-context/1.0 (rental verification research)"

    # --- database (Firestore Enterprise, MongoDB wire protocol) ----------
    #: Connection string from the Firestore Enterprise database page in the
    #: Google Cloud console. Enterprise edition speaks MongoDB, not the native
    #: Firestore API, so this is what the data layer connects to.
    firestore_enterprise_uri: str = ""
    database_name: str = "khoj_production"

    #: Pool sizing. A verification call holds a coroutine open for minutes while
    #: CALL-E talks, so connections are held longer than a typical request/response
    #: service and the floor is kept above zero to avoid reconnect churn.
    mongo_max_pool_size: int = 50
    mongo_min_pool_size: int = 2
    #: Fast-fail rather than the driver's 30s default. A cluster that is
    #: unreachable should surface in a health check in a few seconds, not hang a
    #: request until a proxy gives up first.
    mongo_server_selection_timeout_ms: int = 3_000
    mongo_connect_timeout_ms: int = 3_000
    mongo_socket_timeout_ms: int = 3_000

    #: Create indexes on startup. Turn off where the deploy user is not allowed
    #: to issue DDL and an administrator manages indexes out of band.
    ensure_indexes_on_startup: bool = True

    # --- firebase --------------------------------------------------------
    #: Path to a service-account JSON file. Leave empty on Cloud Run / GCE and
    #: the Admin SDK picks up ambient application-default credentials.
    firebase_credentials_file: str = ""
    firebase_project_id: str = ""
    #: Storage bucket for call recordings, e.g. ``my-project.appspot.com``.
    firebase_storage_bucket: str = ""

    # --- llm -------------------------------------------------------------
    #: Which provider is tried first. "anthropic" falls back to Gemini on
    #: rate limits and outages; "gemini" skips Anthropic entirely.
    llm_provider: Literal["anthropic", "gemini", "openai"] = "gemini"

    #: Anthropic. Optional — without a key the failover is simply not armed
    #: and everything runs on Gemini exactly as before.
    anthropic_api_key: str = ""
    anthropic_model: str = "claude-haiku-4-5-20251001"

    #: Fall back to the secondary provider when the primary rate-limits or
    #: times out. The Gemini free tier allows 20 requests a day, which one
    #: afternoon of testing exhausts, so this is not a theoretical concern.
    llm_failover: bool = True
    gemini_api_key: str = ""
    openai_api_key: str = ""

    #: Cheap, fast model for bulk page extraction.
    extraction_model: str = "gemini-3.6-flash"
    #: Model for preference parsing and honesty evaluation, where nuance matters.
    reasoning_model: str = "gemini-3.6-flash"
    #: Speech-to-speech model driving the phone conversation.
    realtime_model: str = "gpt-4o-realtime-preview-2024-12-17"
    realtime_voice: str = "alloy"

    # --- telephony (CALL-E) ---------------------------------------------
    telephony_provider: Literal["calle", "mock"] = "mock"
    calle_api_key: str = ""
    calle_base_url: str = "https://api.heycall-e.com"
    #: HTTP timeout for a single SDK request, not for the call itself.
    #:
    #: Bounds one request — creating the task, or one poll. The length of the
    #: *conversation* is governed by ``calle_timeout_seconds``, which is
    #: measured in minutes, and by the ``asyncio.wait_for`` ceiling in the
    #: dialer; neither of those is this.
    #:
    #: Do not tighten this speculatively. It was briefly cut to 10s on the
    #: theory that a strict bound would stop a row wedging at DIALING, and it
    #: did the opposite: creating a call is not a trivial request, and every
    #: dial from the deployed host started failing with "CALL-E API request
    #: timed out" while the same code worked from a laptop still on the old
    #: default. The wedge it was meant to prevent is already handled where it
    #: belongs — a request that hangs is caught by the dialer's own deadline.
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

    # --- deadlines -------------------------------------------------------
    #: Every one of these bounds an await that had no bound at all, and each
    #: was chosen because a *hang* is not an exception: the search runs as a
    #: background task, so nothing above it ever times out on its behalf. A
    #: coroutine that never returns left the session in `scraping` for good,
    #: which the customer reads as "still working" forever. Failing loudly
    #: after a deadline is worse than succeeding and far better than that.

    #: Starting headless Chromium. It is the launch, not the page load, that
    #: hangs on a small instance: the browser needs more memory than a starter
    #: dyno has, and it stalls rather than refusing.
    browser_launch_timeout_s: float = 45.0

    #: One portal, end to end — navigation, scrolling, contact reveals. Well
    #: above `scrape_timeout_ms` because that bounds only the initial goto,
    #: while lazy-loading and reveal clicks happen afterwards.
    site_read_timeout_s: float = 120.0

    #: Every portal together, including browser startup. A backstop for a stall
    #: that is not inside any single site's work.
    crawl_timeout_s: float = 300.0

    #: One page of listing text through the model. A rate-limited provider can
    #: leave an HTTP request open indefinitely.
    extraction_timeout_s: float = 120.0

    #: The whole search. The last line of defence: whatever hangs and wherever,
    #: the session gets a terminal status and the customer gets an answer.
    search_timeout_s: float = 900.0
    #: Identify the crawler honestly. Do not set this to a browser UA string to
    #: evade bot detection.
    user_agent: str = (
        "KhojBot/0.1 (+https://github.com/manyamharshitha/KHOJ; rental verification)"
    )

    #: How long POST /api/search may wait for the model to read the prompt.
    #:
    #: This call sits in front of the 202 that unblocks the browser, so it is
    #: bounded rather than allowed to run as long as the model likes. A timeout
    #: costs the inferred extras, not the search.
    preference_parse_timeout_s: float = 20.0

    # --- SMS, geocoding and site visits ----------------------------------
    #: Twilio. Absent means messages are logged and reported as not sent, never
    #: recorded as sent — a site visit hangs off "the broker was asked at 14:00".
    twilio_account_sid: str | None = None
    twilio_auth_token: str | None = None
    twilio_from_number: str | None = None

    #: Google Maps, for turning a property address into a point. Absent means a
    #: visit is recorded as un-checkable rather than as verified.
    google_maps_api_key: str | None = None

    #: How far the video may be from the address and still pass.
    #:
    #: GPS indoors is routinely tens of metres out — concrete, lifts and upper
    #: floors all degrade it — so this is a triage threshold, not a verdict. A
    #: visit beyond it is flagged for a person, never auto-failed.
    site_visit_radius_m: int = 150

    #: How late a video may arrive and still count, in minutes.
    site_visit_grace_minutes: int = 30

    #: Upload ceiling. Two minutes of phone video is ~20-40 MB; 100 covers a
    #: high-bitrate camera without letting the endpoint become file storage.
    site_visit_max_bytes: int = 100 * 1024 * 1024

    #: Where uploaded videos are written. Local disk by default: S3 is the
    #: production answer but a bucket that does not exist yet must not stop the
    #: flow from working end to end on a laptop.
    site_visit_dir: str = "var/site_visits"

    #: Public base URL used to build the link inside the SMS. Must be reachable
    #: from the broker's phone, so localhost only works in local testing.
    public_base_url: str = "http://localhost:5173"

    #: Whether this process runs the site-visit scheduler.
    #:
    #: Off for a second instance, and off in tests. The loop claims a row by
    #: moving it out of SCHEDULED before sending, which narrows but does not
    #: close the window in which two instances both send the same message —
    #: so today exactly one process should have this on.
    run_visit_scheduler: bool = True

    # --- authenticated contact reveal ------------------------------------
    #: A signed-in session captured by ``scripts/generate_auth.py``. Relative
    #: paths resolve against the backend root, then the scraping package, then
    #: the working directory. Absent means the crawler reads anonymously, which
    #: is the safe default rather than an error.
    magicbricks_auth_file: str = "magicbricks_auth.json"

    #: How many numbers to actually unlock on one page.
    #:
    #: Counted in *successful reveals*, not clicks: portals meter the free tier
    #: on numbers unlocked, so that is the number worth capping. Three is
    #: deliberately below what a browsing person would open — the account can
    #: only place ``max_calls_per_day`` calls anyway, so unlocking more buys
    #: nothing and spends quota that does not come back.
    max_contact_reveals: int = 3

    #: How many controls to click while trying to reach that number.
    #:
    #: The second ceiling exists because the first one cannot bound the failure
    #: case. Stopping only at three *successes* means a page where nothing
    #: succeeds — an expired session, a rate limit, changed markup — never stops
    #: at all, and clicks every control on the page. That is precisely the
    #: behaviour the reveal cap is meant to prevent, so the attempts are bounded
    #: separately.
    max_contact_attempts: int = 8

    #: Consecutive clicks that reveal nothing before giving up on the page.
    #:
    #: Three misses in a row is not bad luck; it is a session that has expired
    #: or a portal that has started refusing. Continuing past that spends the
    #: account's credibility on clicks that are already known not to work.
    max_contact_misses: int = 3

    #: Patience per click. Short deliberately: a control that has not produced a
    #: number in this long is a gate or a rate limit, not a slow page, and
    #: waiting longer on twelve cards turns one search into several minutes.
    contact_reveal_timeout_ms: int = 5_000

    #: Pause between clicks, so a page of reveals does not arrive as a burst.
    contact_reveal_delay_ms: int = 1_200

    #: Warn when the saved session is older than this. Portal sessions expire
    #: quietly, and an expired one looks exactly like a portal that changed its
    #: markup unless the age is reported.
    auth_state_max_age_days: int = 7

    # --- calling policy --------------------------------------------------
    max_concurrent_calls: int = 3
    max_calls_per_session: int = 20

    #: Calls one account may place in a rolling 24 hours, whatever the plan.
    #: A phone call reaches a stranger, so the ceiling is on the account and
    #: not only on the wallet.
    max_calls_per_day: int = 1

    #: Total calls a free account may ever place. The daily limit alone
    #: would let a free account call forever, one a day.
    free_plan_lifetime_calls: int = 2
    #: Do not dial the same number twice inside this window, across sessions.
    number_cooldown_days: int = 7
    #: TRAI-friendly windows, IST, as ``HH:MM-HH:MM`` comma separated.
    call_windows_ist: str = "11:00-13:00,17:00-20:00"
    ignore_call_window: bool = False

    #: Developer escape hatch: skip the calling window *and* the per-number
    #: cooldown, so the same test number can be dialled repeatedly.
    #:
    #: The cooldown is the one that actually bites during testing. The window
    #: only defers a call outside business hours, but the cooldown marks a
    #: repeat call BLOCKED and never dials it — which looks identical to "the
    #: phone never rang" from the outside. Never enable this in production: the
    #: cooldown is what stops one broker being rung by five customers in a week.
    bypass_call_window: bool = False
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
        """CORS origins as a list, normalised.

        Trailing slashes are stripped because a browser never sends one. The
        Origin header is scheme + host + port and nothing else, so a configured
        value of ``https://example.com/`` matches no request that will ever
        arrive — the preflight is refused and every call fails with a CORS error
        that looks like the server is down. Normalising here means the setting
        works whether or not somebody pasted the slash.
        """
        return [o.strip().rstrip("/") for o in self.frontend_origins.split(",") if o.strip()]

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
