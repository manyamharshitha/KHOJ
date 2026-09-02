"""CALL-E integration — the only telephony provider.

Written against the installed ``calle-ai`` SDK. Two facts about it shape this
module:

**The task is prose, not a state machine.** There is no per-question endpoint, so
the persona and the customer's questions are rendered into one natural-language
instruction. The agent decides what to say and in what order, which is what lets
it follow "actually the flat upstairs is also free" instead of ploughing through
a fixed list.

**CALL-E extracts structured JSON itself.** A ``recipient_result_schema`` comes
back filled in from the call, so the verification fields need no model of our
own. Our LLM is still used for the honesty evaluation, which needs the
transcript and the advert side by side.

``create_and_wait`` is blocking and polls on a background thread, so every call
into the SDK is wrapped in ``asyncio.to_thread`` — a blocking poll on the event
loop would stall every other call in flight.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from typing import Any

from app.config import settings
from app.models import CallStatus, Listing, QnAPair, SearchCriteria, Speaker, TranscriptTurn

log = logging.getLogger(__name__)


class CalleUnavailable(RuntimeError):
    """No API key, or the SDK is not installed."""


@dataclass(slots=True)
class CallOutcome:
    """What one completed CALL-E task tells us."""

    provider_call_id: str
    status: CallStatus
    transcript: list[TranscriptTurn] = field(default_factory=list)
    structured: dict[str, Any] = field(default_factory=dict)
    qna: list[QnAPair] = field(default_factory=list)
    duration_sec: int | None = None
    recording_url: str | None = None
    consent_to_record: bool | None = None
    summary: str | None = None
    error: str | None = None


# --------------------------------------------------------------------------
# the schema CALL-E fills in
# --------------------------------------------------------------------------


def verification_schema(criteria: SearchCriteria) -> dict[str, Any]:
    """The structured result CALL-E extracts from the conversation.

    String enums with an explicit ``"unknown"`` rather than booleans. A boolean
    forces "they never said" to collapse into "no", which is a lie the customer
    then acts on. Everything unstated must stay recoverable as unknown.

    The customer's own questions are appended as free-text fields so anything she
    specifically wanted asked comes back as a real field, not buried in a summary.
    """
    tri = {"type": "string", "enum": ["yes", "no", "unknown"]}

    properties: dict[str, Any] = {
        "available": {
            **tri,
            "description": (
                "yes only if they offered a concrete way to see THIS flat — a day, "
                "a time, 'anytime', 'come today'. no if it is gone, taken or rented. "
                "unknown if they were merely vague."
            ),
        },
        "bait_pivot": {
            **tri,
            "description": (
                "yes when they steered away from the advertised flat toward a "
                "different property. Record yes even if they also claimed the "
                "original was available."
            ),
        },
        "rent_actual": {
            "type": "string",
            "description": (
                "Monthly rent in rupees as a plain integer string, e.g. '32000'. "
                "'thirty-two thousand' is 32000, '32k' is 32000, '1.2 lakh' is "
                "120000. Empty string if never stated."
            ),
        },
        "maintenance_actual": {
            "type": "string",
            "description": (
                "Monthly maintenance in rupees, separate from rent. '0' if they "
                "said there is none. Empty string if never stated."
            ),
        },
        "deposit_actual": {
            "type": "string",
            "description": (
                "Deposit as stated: a rupee figure, or a number of months like "
                "'3 months'. Empty string if never stated."
            ),
        },
        "brokerage": {
            "type": "string",
            "description": (
                "Brokerage in months of rent: '1', '0.5', '0' for none. Empty "
                "string if never stated."
            ),
        },
        "water_supply": {
            "type": "string",
            "description": (
                "What they said about water — borewell, corporation, tanker, "
                "24 hours, timings. Empty string if not discussed."
            ),
        },
        "restrictions": {
            "type": "string",
            "description": (
                "Any restrictions mentioned: non-veg, pets, bachelors, visitors, "
                "gate timings. Empty string if none were mentioned."
            ),
        },
        "is_broker": {
            **tri,
            "description": (
                "yes if the person is an agent or handling it for the owner, no if "
                "they are the owner themselves."
            ),
        },
        "consent_to_record": {
            **tri,
            "description": "Whether they agreed to the call being recorded when asked at the start.",
        },
        # --- commitment and cost, beyond the headline rent -----------------
        # These are the terms that decide whether a flat is actually affordable.
        # A cheap rent with an 11-month lock-in, a two-month notice period and a
        # 10% annual hike costs more than a dearer flat with none of that, and
        # none of it ever appears in a listing.
        "available_from": {
            "type": "string",
            "description": (
                "When the flat can actually be moved into, as they said it — "
                "'immediately', '1st of next month', 'after 15 days', a date. "
                "Empty string if never stated."
            ),
        },
        "lock_in_months": {
            "type": "string",
            "description": (
                "Minimum lease or lock-in period in months as a plain integer "
                "string, e.g. '11'. '0' if they said there is none. Empty string "
                "if never stated."
            ),
        },
        "notice_period_months": {
            "type": "string",
            "description": (
                "Notice required before vacating, in months, e.g. '2'. Empty "
                "string if never stated."
            ),
        },
        "rent_escalation": {
            "type": "string",
            "description": (
                "Annual rent increase as they stated it — '5%', '10 percent', "
                "'no increase'. Empty string if never stated."
            ),
        },
        "maintenance_includes": {
            "type": "string",
            "description": (
                "What the maintenance charge actually covers — water, common "
                "area, lift, security, club house. Empty string if not discussed."
            ),
        },
        "agreement_charges": {
            "type": "string",
            "description": (
                "Who pays for the rental agreement, stamp duty or registration, "
                "and roughly how much. Empty string if not discussed."
            ),
        },

        # --- what the flat physically has ----------------------------------
        "parking": {
            "type": "string",
            "description": (
                "Parking as described — car, two-wheeler, covered or open, "
                "included in rent or charged extra. Empty string if not "
                "discussed."
            ),
        },
        "power_backup": {
            "type": "string",
            "description": (
                "Power backup: generator, inverter, none, and whether it covers "
                "the flat or only common areas. Empty string if not discussed."
            ),
        },
        "floor_and_lift": {
            "type": "string",
            "description": (
                "Which floor the flat is on and whether the building has a lift, "
                "e.g. '3rd floor, lift available'. Empty string if not discussed."
            ),
        },
        "furnishing_included": {
            "type": "string",
            "description": (
                "What furniture and appliances actually come with the flat — "
                "beds, wardrobes, AC, geyser, fridge, modular kitchen. Empty "
                "string if not discussed."
            ),
        },

        "notes": {
            "type": "string",
            "description": "One short sentence of context a tenant would want. Empty if none.",
        },
    }

    for index, question in enumerate(criteria.custom_questions[:8]):
        properties[f"custom_{index}"] = {
            "type": "string",
            "description": (
                f"Their answer to the tenant's own question: \"{question}\". "
                "Empty string if it was not asked or not answered."
            ),
        }

    return {
        "type": "object",
        "additionalProperties": False,
        "required": list(properties),
        "properties": properties,
    }


# --------------------------------------------------------------------------
# translating CALL-E's response
# --------------------------------------------------------------------------


def _tri(value: Any) -> bool | None:
    """Three states, not two. Anything but a clear yes/no is unknown."""
    text = str(value or "").strip().lower()
    return True if text == "yes" else False if text == "no" else None


def _map_status(task: dict[str, Any], attempt: dict[str, Any] | None) -> CallStatus:
    """CALL-E's lifecycle onto ours."""
    status = str(task.get("status") or "")
    turns = (attempt or {}).get("transcript_turns") or []

    if status == "completed" and turns:
        return CallStatus.COMPLETED
    if status == "canceled":
        return CallStatus.CANCELLED

    code = str((attempt or {}).get("failure_code") or task.get("failure_code") or "").lower()
    if any(k in code for k in ("no_answer", "noanswer", "timeout")):
        return CallStatus.NO_ANSWER
    if "busy" in code:
        return CallStatus.BUSY
    if any(k in code for k in ("decline", "reject")):
        return CallStatus.FAILED
    # A completed task with no transcript connected to nothing useful.
    return CallStatus.NO_ANSWER if status == "completed" else CallStatus.FAILED


def _map_turns(raw: list[dict[str, Any]]) -> list[TranscriptTurn]:
    """CALL-E reports ``bot`` and ``user``; on an outbound call the user is the
    person we rang. Diarisation is a fact about the channel, not a guess."""
    out: list[TranscriptTurn] = []
    for turn in raw:
        text = str(turn.get("text") or "").strip()
        if not text:
            continue
        offset = turn.get("offset_seconds")
        out.append(
            TranscriptTurn(
                speaker=Speaker.AGENT if turn.get("speaker") == "bot" else Speaker.OWNER,
                text=text,
                timestamp=float(offset) if offset is not None else 0.0,
            )
        )
    return out


def _build_qna(
    structured: dict[str, Any], criteria: SearchCriteria, turns: list[TranscriptTurn]
) -> list[QnAPair]:
    """The transparency record: what was asked, and what came back.

    A field CALL-E left empty becomes a pair with a null answer rather than being
    dropped. A question that went unanswered is information the customer needs —
    silently omitting it would make the record look complete when it is not.
    """
    labels = [
        ("available", "When can she come and see the flat?"),
        ("rent_actual", "What is the rent right now?"),
        ("maintenance_actual", "What is the maintenance charge?"),
        ("deposit_actual", "What is the deposit?"),
        ("brokerage", "Is there a brokerage, and how much?"),
        ("water_supply", "What is the water supply like?"),
        ("restrictions", "Are there any restrictions on tenants?"),
        ("is_broker", "Are you the owner, or handling it for them?"),
        ("available_from", "When is the flat available to move into?"),
        ("lock_in_months", "Is there a minimum lease or lock-in period?"),
        ("notice_period_months", "How much notice is needed before vacating?"),
        ("rent_escalation", "Is there an annual rent increase?"),
        ("maintenance_includes", "What does the maintenance charge cover?"),
        ("agreement_charges", "Who pays for the agreement and registration?"),
        ("parking", "Is there parking, and is it included?"),
        ("power_backup", "Is there power backup?"),
        ("floor_and_lift", "Which floor is it on, and is there a lift?"),
        ("furnishing_included", "What furniture and appliances are included?"),
    ]
    labels += [
        (f"custom_{i}", question) for i, question in enumerate(criteria.custom_questions[:8])
    ]

    owner_said = " ".join(t.text for t in turns if t.speaker is Speaker.OWNER)

    pairs: list[QnAPair] = []
    for key, question in labels:
        raw = structured.get(key)
        answer = str(raw).strip() if raw not in (None, "", "unknown") else None
        pairs.append(
            QnAPair(
                question=question,
                answer=answer,
                # A per-field quote is not available from the provider; the
                # honesty evaluator attaches verified quotes afterwards.
                quote=None,
                asked_at=None,
            )
        )
    if not owner_said:
        log.debug("calle: no owner speech in transcript, Q&A will be answers-only")
    return pairs


# --------------------------------------------------------------------------
# the dialer
# --------------------------------------------------------------------------


class CalleDialer:
    """Places verification calls through CALL-E."""

    name = "calle"

    def __init__(self) -> None:
        if not settings.calle_api_key:
            raise CalleUnavailable(
                "CALLE_API_KEY is not set. Add it to .env, or run TELEPHONY_PROVIDER=mock."
            )
        try:
            from calle import CalleClient
        except ImportError as exc:  # pragma: no cover - dependency is declared
            raise CalleUnavailable("The calle-ai package is not installed.") from exc

        self._client = CalleClient(
            api_key=settings.calle_api_key,
            base_url=settings.calle_base_url,
            timeout=settings.calle_http_timeout,
        )

    async def verify(
        self,
        *,
        call_id: str,
        listing: Listing,
        criteria: SearchCriteria,
        task: str,
        attempt: int = 1,
    ) -> CallOutcome:
        """Dial the listing's contact and return what was learned.

        Blocks for as long as the call runs, which is why it is dispatched to a
        thread. The idempotency key includes the attempt, so a retried *request*
        never dials twice while a genuine second attempt still gets through.
        """
        phone = listing.contact_number
        if not phone:
            return CallOutcome(
                provider_call_id="",
                status=CallStatus.FAILED,
                error="listing has no contact number",
            )

        payload: dict[str, Any] = {
            "task": task,
            "recipient": {
                "phones": [phone],
                "region": settings.call_region,
                "locale": settings.call_locale,
            },
            "recipient_result_schema": verification_schema(criteria),
            "metadata": {
                "call_id": call_id,
                "listing_id": listing.id,
                "session_id": listing.session_id,
            },
            "idempotency_key": f"{call_id}:{attempt}",
            "interval_seconds": settings.calle_poll_seconds,
            "timeout_seconds": settings.calle_timeout_seconds,
        }

        from calle import CalleAPIError, CalleTimeoutError

        try:
            task_result: dict[str, Any] = await asyncio.to_thread(
                self._client.calls.create_and_wait, **payload
            )
        except CalleTimeoutError as exc:
            log.warning("[%s] CALL-E timed out: %s", call_id, exc)
            return CallOutcome(
                provider_call_id="", status=CallStatus.FAILED, error=f"timed out: {exc}"
            )
        except CalleAPIError as exc:
            log.warning("[%s] CALL-E refused the call: %s", call_id, exc)
            return CallOutcome(
                provider_call_id="", status=CallStatus.FAILED, error=str(exc)[:400]
            )
        except Exception as exc:  # noqa: BLE001 - transport, auth, anything
            log.exception("[%s] CALL-E call failed", call_id)
            return CallOutcome(
                provider_call_id="", status=CallStatus.FAILED, error=str(exc)[:400]
            )

        return self._read_outcome(task_result, criteria)

    def _read_outcome(self, task: dict[str, Any], criteria: SearchCriteria) -> CallOutcome:
        """Translate one CALL-E task into our shape.

        We place one task per listing with a single recipient, so the interesting
        data is the last attempt of the first recipient — the one that connected.
        """
        recipients = task.get("recipients") or []
        recipient = recipients[0] if recipients else {}
        attempts = recipient.get("attempts") or []
        attempt = attempts[-1] if attempts else None

        turns = _map_turns((attempt or {}).get("transcript_turns") or [])
        structured = recipient.get("structured_result") or {}

        duration: int | None = None
        if attempt and attempt.get("started_at") and attempt.get("completed_at"):
            from datetime import datetime

            try:
                started = datetime.fromisoformat(str(attempt["started_at"]).replace("Z", "+00:00"))
                ended = datetime.fromisoformat(str(attempt["completed_at"]).replace("Z", "+00:00"))
                duration = max(0, int((ended - started).total_seconds()))
            except ValueError:
                duration = None
        if duration is None and turns:
            duration = int(turns[-1].timestamp) + 2

        return CallOutcome(
            provider_call_id=str(task.get("id") or ""),
            status=_map_status(task, attempt),
            transcript=turns,
            structured=structured,
            qna=_build_qna(structured, criteria, turns),
            duration_sec=duration,
            recording_url=(attempt or {}).get("recording_url"),
            consent_to_record=_tri(structured.get("consent_to_record")),
            summary=recipient.get("summary") or task.get("summary"),
            error=(attempt or {}).get("failure_message") or task.get("failure_message"),
        )

    def close(self) -> None:
        self._client.close()


def spoken_int(value: Any) -> int | None:
    """A rupee figure CALL-E returned, as an integer, or None.

    Never guesses. An empty string, ``"unknown"`` or unparseable text all become
    ``None``, because the whole point of the call was to find this out and a
    fabricated number is worse than admitting we still do not know.
    """
    text = str(value or "").strip().lower()
    if not text or text in ("unknown", "n/a", "na", "-"):
        return None
    digits = "".join(c for c in text if c.isdigit() or c == ".")
    if not digits:
        return None
    try:
        number = float(digits)
    except ValueError:
        return None
    if "lakh" in text or "lac" in text:
        number *= 100_000
    elif "k" in text and number < 1000:
        number *= 1000
    return int(number) if number > 0 else None
