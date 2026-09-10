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


#: SIP response codes, which is what CALL-E's ``failure_code`` carries once a
#: leg has reached a carrier at all.
#:
#: Read these and never the ``summary``. CALL-E's summary is model-written prose
#: that guesses at a cause it was not told — it says "the recipient may be
#: unavailable" for a 503, which is a fault in the carrier's network and says
#: nothing whatever about the recipient.
SIP_MEANINGS: dict[str, str] = {
    "404": (
        "the carrier had no route to this number. Nothing rang. On an Indian "
        "mobile this normally means the telephony account cannot terminate "
        "calls to +91 numbers"
    ),
    "400": "the carrier rejected the call setup as malformed",
    "403": "the carrier refused the route or the caller ID",
    "406": (
        "the destination network refused the call's parameters. Nothing rang. "
        "This is usually a codec or media negotiation the carrier would not "
        "accept, and it is decided between the two networks rather than by the "
        "person being called"
    ),
    "408": "it rang and nobody picked up",
    "410": "the number is no longer in service",
    "480": "the phone was switched off or out of coverage",
    "484": "the number was incomplete — check the digits and the country code",
    "486": "the line was engaged",
    "487": "the call was cancelled before it was answered",
    "488": (
        "the two networks could not agree on a codec, so no audio path could "
        "be opened. Nothing rang"
    ),
    "502": "an intermediate gateway failed",
    "504": "the carrier timed out setting the call up",
    "600": "the person is busy on every device they have",
    "604": "no network anywhere recognises this number",
    "503": (
        "the carrier or trunk was unavailable. Nothing rang, and this is a "
        "fault on the telephony provider's side rather than anything about "
        "the number"
    ),
    "603": "the phone rejected the call",
}


def describe_failure(task: dict[str, Any], attempt: dict[str, Any] | None) -> str | None:
    """Why the call did not happen, in words that identify the fault.

    CALL-E's own ``failure_message`` is frequently empty, and the fallback on
    the task is the string ``"calling task status=FAILED"`` — which restates
    that it failed and adds nothing. That was what reached the customer, and it
    left both them and us unable to tell a wrong number from a provider outage.

    The SIP code is the part that identifies the failure, so it is put in front
    and translated.
    """
    code = str((attempt or {}).get("failure_code") or task.get("failure_code") or "").strip()
    meaning = SIP_MEANINGS.get(code)

    if meaning:
        return f"The call could not be connected — {meaning} (SIP {code})."

    stated = (attempt or {}).get("failure_message") or task.get("failure_message")
    # The generic restatement is worse than saying plainly that we do not know.
    if stated and "status=FAILED" not in str(stated):
        return str(stated)[:400]
    if code:
        return f"The call could not be connected (provider code {code})."
    return "The call could not be connected, and the provider gave no reason."


def _map_status(task: dict[str, Any], attempt: dict[str, Any] | None) -> CallStatus:
    """CALL-E's lifecycle onto ours.

    NO_ANSWER is reserved for a telephone that genuinely rang and was not picked
    up. It is not the fallback for "we cannot tell", because those two look
    identical on screen and only one of them means the number was ever dialled —
    a provider that rejected the task outright was being reported to the
    customer as a broker who did not answer.
    """
    status = str(task.get("status") or "")
    turns = (attempt or {}).get("transcript_turns") or []

    if status == "completed" and turns:
        return CallStatus.COMPLETED
    if status == "canceled":
        return CallStatus.CANCELLED

    # No attempt at all means CALL-E never took the task as far as dialling.
    # Whatever went wrong, the phone did not ring.
    if attempt is None:
        return CallStatus.FAILED

    code = str(attempt.get("failure_code") or task.get("failure_code") or "").lower()

    # Numeric SIP codes first. The word checks below never match one — "busy"
    # is not a substring of "486" — so a carrier that answers in codes rather
    # than prose fell through to the catch-all and was recorded as whatever the
    # task status happened to be.
    numeric = {
        # Reached the handset. The person, or their phone, is the reason.
        "408": CallStatus.NO_ANSWER,
        "480": CallStatus.NO_ANSWER,
        "486": CallStatus.BUSY,
        "600": CallStatus.BUSY,
        "603": CallStatus.FAILED,
        # Never reached the handset. Nothing rang, so none of these may become
        # NO_ANSWER — saying "nobody answered" about a call that was refused
        # between two carriers invents an event that did not happen.
        "400": CallStatus.FAILED,
        "403": CallStatus.FAILED,
        "404": CallStatus.FAILED,
        "406": CallStatus.FAILED,
        "410": CallStatus.FAILED,
        "484": CallStatus.FAILED,
        "488": CallStatus.FAILED,
        "502": CallStatus.FAILED,
        "503": CallStatus.FAILED,
        "504": CallStatus.FAILED,
        "604": CallStatus.FAILED,
        "487": CallStatus.CANCELLED,
    }
    if code in numeric:
        return numeric[code]

    if any(k in code for k in ("no_answer", "noanswer")):
        return CallStatus.NO_ANSWER
    if "busy" in code:
        return CallStatus.BUSY
    if any(k in code for k in ("decline", "reject")):
        return CallStatus.FAILED
    # A timeout is ours, not theirs: the poll gave up, and whether anyone would
    # have answered is unknown. Reporting it as NO_ANSWER asserts something
    # about the person on the other end that was never observed.
    if "timeout" in code:
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

        # A deadline of our own, above the one handed to the SDK.
        #
        # `create_and_wait` polls on a background thread, and `asyncio.to_thread`
        # cannot be cancelled — if that thread blocks and never returns, the
        # await here never completes either. Nothing downstream runs, no status
        # is written, and the row sits at DIALING forever while the dashboard
        # says "Calling now" about a telephone that is not ringing.
        #
        # `wait_for` does not kill the thread (Python cannot), but it hands
        # control back so the failure is recorded and the customer is told. The
        # margin is generous: this must only ever fire when the SDK has ignored
        # its own `timeout_seconds`, never on a call that is legitimately long.
        deadline = settings.calle_timeout_seconds + 60.0

        log.info(
            "[%s] dialling %s via CALL-E (call timeout %.0fs, http timeout %.0fs)",
            call_id,
            phone,
            settings.calle_timeout_seconds,
            settings.calle_http_timeout,
        )

        try:
            task_result: dict[str, Any] = await asyncio.wait_for(
                asyncio.to_thread(self._client.calls.create_and_wait, **payload),
                timeout=deadline,
            )
        except (TimeoutError, asyncio.TimeoutError):
            log.error(
                "[%s] CALL-E did not return within %.0fs — abandoning the wait. "
                "The SDK ignored its own timeout_seconds; the worker thread may "
                "still be running.",
                call_id,
                deadline,
            )
            return CallOutcome(
                provider_call_id="",
                status=CallStatus.FAILED,
                error=(
                    f"CALL-E did not respond within {deadline:.0f}s. The call was "
                    "abandoned; it may or may not have been placed."
                ),
            )
        except CalleTimeoutError as exc:
            # Say which ceiling was hit and what it was set to. "timed out" on
            # its own is unactionable: an HTTP request that never came back and
            # a call that ran past its limit read identically, and the fix for
            # one is nothing like the fix for the other.
            log.warning(
                "[%s] CALL-E timed out (http=%.0fs, call=%.0fs): %s",
                call_id,
                settings.calle_http_timeout,
                settings.calle_timeout_seconds,
                exc,
            )
            return CallOutcome(
                provider_call_id="",
                status=CallStatus.FAILED,
                error=(
                    f"CALL-E did not respond in time ({exc}). Per-request limit is "
                    f"{settings.calle_http_timeout:.0f}s and the call limit is "
                    f"{settings.calle_timeout_seconds:.0f}s. If this happens on every "
                    "call from a deployed host but not locally, the network path is "
                    "slower there — raise CALLE_HTTP_TIMEOUT."
                )[:400],
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

        outcome = self._read_outcome(task_result, criteria)
        log.info(
            "[%s] CALL-E returned status=%s provider_id=%s turns=%d",
            call_id,
            outcome.status.value,
            outcome.provider_call_id or "<none>",
            len(outcome.transcript),
        )
        return outcome

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
            error=None if _map_status(task, attempt) is CallStatus.COMPLETED
            else describe_failure(task, attempt),
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
