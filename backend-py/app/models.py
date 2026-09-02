"""Typed document models for every Firestore collection.

Firestore is schemaless, which means the schema lives here or nowhere. Every
read and write in ``repositories.py`` goes through these models, so a field
rename is a type error rather than a silent ``None`` three weeks later.

A rule that runs through all of them: **a missing value is ``None``, never a
guess.** A blank field costs the customer one phone call; a wrong field costs
her a Saturday. Optional fields are optional because the information genuinely
may not exist, and nothing downstream is allowed to invent one.
"""

from __future__ import annotations

from datetime import datetime, timezone
from enum import StrEnum
from typing import Annotated, Any

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, field_validator

# --------------------------------------------------------------------------
# shared
# --------------------------------------------------------------------------


def utcnow() -> datetime:
    """Timezone-aware UTC now. Firestore stores naive datetimes ambiguously."""
    return datetime.now(timezone.utc)


class Base(BaseModel):
    """Common config: reject unknown fields so typos fail loudly."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    def to_firestore(self) -> dict[str, Any]:
        """Serialise for Firestore, keeping datetimes native and dropping unset."""
        return self.model_dump(mode="python", exclude_none=False)


Rupees = Annotated[int, Field(ge=0, le=100_000_000)]
Score10 = Annotated[float, Field(ge=0.0, le=10.0)]
Unit = Annotated[float, Field(ge=0.0, le=1.0)]


# --------------------------------------------------------------------------
# search session
# --------------------------------------------------------------------------


class SessionStatus(StrEnum):
    QUEUED = "queued"
    SCRAPING = "scraping"
    EXTRACTING = "extracting"
    RANKED = "ranked"
    CALLING = "calling"
    COMPLETE = "complete"
    FAILED = "failed"


class TenantProfile(StrEnum):
    FAMILY = "family"
    BACHELORS = "bachelors"
    WORKING_PROFESSIONAL = "working_professional"
    ANYONE = "anyone"


class SearchCriteria(Base):
    """Structured requirements parsed from the customer's free-text prompt.

    Everything is optional. The customer said what she said; fields she did not
    mention stay ``None`` and are simply not used as filters, rather than being
    filled with a plausible default that silently narrows her search.
    """

    city: str | None = None
    localities: list[str] = Field(default_factory=list)
    property_type: str | None = Field(default=None, description="e.g. '2BHK', 'studio'")
    bedrooms: int | None = Field(default=None, ge=0, le=20)

    max_total_monthly: Rupees | None = Field(
        default=None, description="Ceiling on rent + maintenance combined."
    )
    max_deposit: Rupees | None = None
    max_brokerage_months: float | None = Field(default=None, ge=0, le=12)

    furnishing: str | None = None
    tenant_profile: TenantProfile | None = None
    pets_allowed: bool | None = None
    non_veg_allowed: bool | None = None

    max_property_age_years: float | None = Field(default=None, ge=0, le=200)
    move_in_by: str | None = Field(default=None, description="ISO date, if stated.")

    #: Free-text requirements that do not map to a structured field — "good
    #: water supply", "south facing". Carried through to the call script and the
    #: match prompt verbatim so nothing the customer cared about is dropped.
    must_haves: list[str] = Field(default_factory=list)
    nice_to_haves: list[str] = Field(default_factory=list)

    #: Extra questions the customer wants asked on the phone.
    custom_questions: list[str] = Field(default_factory=list)


class TargetSite(Base):
    """One site to search. Either a known portal or a customer-supplied URL."""

    name: str
    url: HttpUrl
    #: True when the site is known to gate contact numbers behind login/OTP.
    contact_gated: bool = False


class SearchSession(Base):
    """One customer search, from prompt to ranked, called-and-verified results."""

    id: str
    customer_id: str | None = None
    prompt: str = Field(min_length=1, max_length=4000)
    criteria: SearchCriteria
    target_sites: list[TargetSite] = Field(min_length=1, max_length=5)

    status: SessionStatus = SessionStatus.QUEUED
    error: str | None = None

    listings_found: int = 0
    listings_matched: int = 0
    calls_placed: int = 0
    calls_completed: int = 0

    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)

    @field_validator("target_sites")
    @classmethod
    def _cap_sites(cls, v: list[TargetSite]) -> list[TargetSite]:
        if len(v) > 5:
            raise ValueError("at most 5 target sites per search")
        return v


# --------------------------------------------------------------------------
# listing
# --------------------------------------------------------------------------


class ListingSourceStatus(StrEnum):
    OK = "ok"
    BLOCKED = "blocked"
    CONTACT_GATED = "contact_gated"
    EMPTY = "empty"
    ERROR = "error"


class Listing(Base):
    """A candidate property, standardised across whatever site it came from.

    ``total_monthly_cost`` is the field the customer is actually ranked on and
    is derived, never taken from the page: portals advertise rent and hide
    maintenance, which is exactly the gap this product exists to close.
    """

    id: str
    session_id: str

    source_site: str
    url: HttpUrl | None = None
    #: The sanitised page text the extraction ran against, kept so a result can
    #: be audited or re-extracted without re-crawling.
    raw_excerpt: str | None = Field(default=None, max_length=20_000)

    title: str | None = None
    locality: str | None = None
    property_type: str | None = None
    bedrooms: int | None = Field(default=None, ge=0, le=20)

    rent: Rupees | None = None
    maintenance: Rupees | None = None
    deposit: Rupees | None = None
    brokerage_months: float | None = Field(default=None, ge=0, le=12)

    age_years: float | None = Field(default=None, ge=0, le=200)
    furnishing: str | None = None
    amenities: list[str] = Field(default_factory=list)

    contact_number: str | None = Field(default=None, description="E.164, or None if gated.")
    contact_name: str | None = None
    is_broker: bool | None = None

    ai_match_score: Unit | None = None
    ai_match_reason: str | None = None

    called: bool = False
    created_at: datetime = Field(default_factory=utcnow)

    @property
    def total_monthly_cost(self) -> int | None:
        """Rent plus maintenance, the number the ranking sorts on.

        ``None`` when rent is unknown — a listing whose cost cannot be
        established must not be ranked as though it were free. Maintenance
        missing is treated as zero, because "not mentioned" overwhelmingly means
        "included" on Indian portals, and the phone call verifies it anyway.
        """
        if self.rent is None:
            return None
        return self.rent + (self.maintenance or 0)

    @property
    def is_callable(self) -> bool:
        """Whether there is a number to dial."""
        return bool(self.contact_number)

    def to_firestore(self) -> dict[str, Any]:
        """Persist the derived total so Firestore can query and order on it."""
        data = super().to_firestore()
        data["total_monthly_cost"] = self.total_monthly_cost
        return data


# --------------------------------------------------------------------------
# call
# --------------------------------------------------------------------------


class CallStatus(StrEnum):
    QUEUED = "queued"
    DIALING = "dialing"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    NO_ANSWER = "no_answer"
    BUSY = "busy"
    FAILED = "failed"
    BLOCKED = "blocked"
    CANCELLED = "cancelled"


class Speaker(StrEnum):
    AGENT = "agent"
    OWNER = "owner"


class TranscriptTurn(Base):
    """One utterance.

    Diarisation is exact rather than inferred: the realtime pipeline knows which
    side produced which audio, so the speaker label is a fact about the channel,
    not a guess from a diarisation model.
    """

    speaker: Speaker
    text: str
    #: Seconds from the start of the call.
    timestamp: float = Field(ge=0)


class QnAPair(Base):
    """A question the agent asked and the answer it got.

    ``quote`` is the owner's exact words. ``answer`` may be a tidied form, but
    the quote is what makes it defensible, and the evidence guard drops any
    answer whose quote is not literally in the transcript.
    """

    question: str
    answer: str | None = None
    quote: str | None = None
    asked_at: float | None = Field(default=None, ge=0)


class CallLog(Base):
    """One outbound call, its recording, and everything that was said."""

    id: str
    session_id: str
    listing_id: str

    phone_dialed: str
    provider_call_id: str | None = None
    call_status: CallStatus = CallStatus.QUEUED

    started_at: datetime | None = None
    ended_at: datetime | None = None
    duration_sec: int | None = Field(default=None, ge=0)

    #: Signed URL into Firebase Storage.
    audio_url: str | None = None
    audio_path: str | None = Field(default=None, description="Storage object path.")

    #: True only if the owner audibly agreed to being recorded.
    consent_to_record: bool | None = None

    transcript: list[TranscriptTurn] = Field(default_factory=list)
    qna_pairs: list[QnAPair] = Field(default_factory=list)

    error: str | None = None
    attempt: int = Field(default=1, ge=1)
    created_at: datetime = Field(default_factory=utcnow)


# --------------------------------------------------------------------------
# honesty analysis
# --------------------------------------------------------------------------


class Discrepancy(Base):
    """One place the phone call contradicted the web listing."""

    field: str = Field(description="e.g. 'maintenance', 'deposit', 'age_years'")
    listing_claim: str
    spoken_claim: str
    quote: str | None = Field(default=None, description="The owner's exact words.")
    severity: Annotated[str, Field(pattern="^(minor|moderate|major)$")] = "moderate"


class EvasiveAnswer(Base):
    """A question that was asked and not straightforwardly answered."""

    question: str
    response: str
    quote: str | None = None
    why_evasive: str


class Verdict(StrEnum):
    TRUSTWORTHY = "trustworthy"
    MOSTLY_CONSISTENT = "mostly_consistent"
    QUESTIONABLE = "questionable"
    LIKELY_MISLEADING = "likely_misleading"
    INSUFFICIENT_EVIDENCE = "insufficient_evidence"


class HonestyReport(Base):
    """LLM evaluation of how well the owner's answers held together.

    Read the naming carefully: this scores *consistency between what was
    advertised and what was said*, not whether the flat exists. Nobody can
    establish that over the phone. Every finding carries the speaker's own
    words, so the score always arrives with its reasons attached.
    """

    id: str
    session_id: str
    listing_id: str
    call_id: str

    honesty_score: Score10 = Field(description="1.0 evasive/contradictory .. 10.0 fully consistent")
    #: How much evidence the score rests on. A short call gives a confident
    #: model very little to be confident about.
    confidence_score: Unit

    listing_discrepancies: list[Discrepancy] = Field(default_factory=list)
    evasive_answers: list[EvasiveAnswer] = Field(default_factory=list)
    red_flags: list[str] = Field(default_factory=list)
    positive_signals: list[str] = Field(default_factory=list)

    final_verdict: Verdict
    summary: str = Field(description="One or two sentences the customer can act on.")

    model: str
    created_at: datetime = Field(default_factory=utcnow)


# --------------------------------------------------------------------------
# API payloads
# --------------------------------------------------------------------------


class UserProfile(Base):
    """A signed-in customer and the plan they are on.

    The tier is read from Firestore, never from the ID token: a plan is
    something this system grants, and a token claim is attacker-influenced.
    """

    uid: str
    email: str = ""
    name: str | None = None
    picture: str | None = None

    tier: str = "free"
    listings_limit: int = Field(default=2, ge=0, le=1000)
    listings_used: int = Field(default=0, ge=0)

    created_at: datetime = Field(default_factory=utcnow)

    @property
    def remaining(self) -> int:
        """Never negative — a downgrade can leave `used` above `limit`."""
        return max(0, self.listings_limit - self.listings_used)


class LeadStatus(StrEnum):
    NEW = "new"
    CONTACTED = "contacted"
    CONVERTED = "converted"
    CLOSED = "closed"


class AgencyLead(Base):
    """Somebody who needs more than the top plan allows.

    A warm inbound lead from a person who has already hit a paid ceiling, so it
    is stored durably first and notified second — a dropped webhook must never
    lose the lead itself.
    """

    id: str
    email: str = Field(min_length=3, max_length=320)
    notes: str | None = Field(default=None, max_length=2000)

    uid: str | None = None
    source: str | None = Field(default=None, description="Which surface it came from.")
    user_agent: str | None = None
    status: LeadStatus = LeadStatus.NEW

    notified: bool = False
    notification_detail: str | None = None
    created_at: datetime = Field(default_factory=utcnow)


class AgencyLeadRequest(Base):
    """``POST /api/leads/custom-agency`` body."""

    email: str = Field(min_length=3, max_length=320)
    notes: str | None = Field(default=None, max_length=2000)
    source: str | None = None

    @field_validator("email")
    @classmethod
    def _looks_like_an_email(cls, v: str) -> str:
        v = v.strip()
        # Deliberately loose. Rejecting a valid-but-unusual address loses a lead
        # that was about to pay us; the only thing worth catching is a typo that
        # could never receive mail.
        if "@" not in v or "." not in v.split("@")[-1] or v.startswith("@") or v.endswith("@"):
            raise ValueError("that does not look like an email address")
        return v


class Verification(Base):
    """One listing verified by phone.

    Stored at ``search_sessions/{session_id}/verifications/{listing_id}`` — the
    complete record of what was asked, what came back, and where the call
    disagreed with the advert.
    """

    listing_id: str
    call_id: str
    listing_title: str | None = None
    phone_dialed: str

    call_status: str
    advertised_total: int | None = None
    spoken_rent: int | None = None
    spoken_maintenance: int | None = None
    spoken_total: int | None = None

    qna_pairs: list[QnAPair] = Field(default_factory=list)
    transcript: list[TranscriptTurn] = Field(default_factory=list)
    audio_url: str | None = None

    honesty_score: Score10 | None = None
    final_verdict: str | None = None
    red_flags: list[str] = Field(default_factory=list)
    summary: str | None = None

    created_at: datetime = Field(default_factory=utcnow)


class SearchRequest(Base):
    """``POST /api/search`` body."""

    prompt: str = Field(min_length=3, max_length=4000)
    #: Portal keys (``nobroker``) or full URLs. Empty means use the defaults.
    sites: list[str] = Field(default_factory=list, max_length=5)
    #: Listing text or raw HTML the customer pasted. Skips crawling entirely,
    #: which is the path that works when a portal gates its contact numbers.
    pasted_content: str | None = Field(default=None, max_length=400_000)
    customer_id: str | None = None
    auto_call: bool = Field(
        default=False, description="Start calling as soon as ranking finishes."
    )


class SearchResponse(Base):
    session_id: str
    status: SessionStatus
    criteria: SearchCriteria
    target_sites: list[TargetSite]
    #: Surfaced up front so the UI can say "we will verify up to N of these"
    #: before the customer waits for a crawl.
    tier: str = "free"
    listings_limit: int = 2


class ListingResult(Base):
    """A ranked listing plus everything learned by calling it."""

    listing: Listing
    total_monthly_cost: int | None
    call: CallLog | None = None
    honesty: HonestyReport | None = None


class SessionResults(Base):
    """``GET /api/session/{id}/results`` body."""

    session: SearchSession
    results: list[ListingResult]
    tier: str = "free"
    listings_limit: int = 2
    #: Ranked but beyond the plan's ceiling, so the customer can see what an
    #: upgrade would buy rather than wondering what was hidden.
    beyond_plan: int = 0
