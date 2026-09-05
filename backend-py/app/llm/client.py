"""Provider-agnostic structured LLM calls.

One function, ``complete_json``, which takes a JSON schema and returns a parsed
object or raises. Gemini and OpenAI both support constrained JSON output, so the
provider is a configuration detail rather than an architectural commitment.

Clients are constructed lazily. Both SDKs raise when their key is missing, and
these modules are imported at boot through the routes — building eagerly would
mean the whole API refuses to start without an LLM key, when extraction is only
one step of the pipeline.
"""

from __future__ import annotations

import json
import logging
from collections.abc import AsyncIterator
from typing import Any, TypeVar

from pydantic import BaseModel, ValidationError
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

from app.config import settings

log = logging.getLogger(__name__)

TModel = TypeVar("TModel", bound=BaseModel)


class LLMError(RuntimeError):
    """The model could not be reached, or returned something unusable."""


class LLMUnavailable(LLMError):
    """No credentials configured for the selected provider."""


_openai_client: Any = None
_gemini_client: Any = None
_anthropic_client: Any = None


def _anthropic() -> Any:
    global _anthropic_client
    if _anthropic_client is None:
        if not settings.anthropic_api_key:
            raise LLMUnavailable("ANTHROPIC_API_KEY is not set")
        from anthropic import AsyncAnthropic

        _anthropic_client = AsyncAnthropic(api_key=settings.anthropic_api_key)
    return _anthropic_client


def anthropic_available() -> bool:
    return bool(settings.anthropic_api_key)


def _is_retryable(exc: BaseException) -> bool:
    """Whether another provider is worth trying for this failure.

    Rate limits, timeouts, connection faults and 5xx are the provider's problem
    and someone else may well succeed. A 400 or a 401 is our problem — the
    prompt is malformed or the key is wrong — and retrying it elsewhere just
    fails twice and doubles the latency.
    """
    try:
        import anthropic
    except ImportError:
        return True

    if isinstance(
        exc,
        (
            anthropic.RateLimitError,
            anthropic.APITimeoutError,
            anthropic.APIConnectionError,
            anthropic.InternalServerError,
        ),
    ):
        return True
    if isinstance(exc, anthropic.APIStatusError):
        return exc.status_code >= 500 or exc.status_code == 429
    text = str(exc).lower()
    return any(
        marker in text
        for marker in ("429", "resource_exhausted", "timeout", "unavailable", "503", "overloaded")
    )


def _openai() -> Any:
    global _openai_client
    if _openai_client is None:
        if not settings.openai_api_key:
            raise LLMUnavailable("OPENAI_API_KEY is not set")
        from openai import AsyncOpenAI

        _openai_client = AsyncOpenAI(api_key=settings.openai_api_key)
    return _openai_client


def _gemini() -> Any:
    global _gemini_client
    if _gemini_client is None:
        if not settings.gemini_api_key:
            raise LLMUnavailable("GEMINI_API_KEY is not set")
        from google import genai

        _gemini_client = genai.Client(api_key=settings.gemini_api_key)
    return _gemini_client


def llm_available() -> bool:
    """Whether the configured provider has credentials.

    Callers use this to degrade gracefully rather than crash — a search with no
    LLM key still crawls and still returns listings, it just cannot rank them
    semantically.
    """
    if settings.llm_provider == "gemini":
        return bool(settings.gemini_api_key)
    return bool(settings.openai_api_key)


def _strip_fences(text: str) -> str:
    """Remove ```json fences some models add despite being asked for raw JSON."""
    t = text.strip()
    if t.startswith("```"):
        t = t.split("\n", 1)[-1] if "\n" in t else t
        if t.endswith("```"):
            t = t[: -3]
        t = t.removeprefix("json").strip()
    return t


@retry(
    retry=retry_if_exception_type(LLMError),
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=1, max=8),
    reraise=True,
)
async def complete_json(
    *,
    system: str,
    user: str,
    schema: dict[str, Any],
    model: str | None = None,
    temperature: float = 0.0,
    max_tokens: int = 8192,
) -> dict[str, Any]:
    """Run a prompt and return schema-constrained JSON.

    Parameters
    ----------
    system:
        Instructions that do not vary with the input. Kept separate so the
        provider can cache the prefix.
    user:
        The actual content — a page, a transcript, a customer prompt.
    schema:
        JSON Schema the response must satisfy.
    temperature:
        Zero by default. Every use here is extraction, where creativity is a
        defect.

    Raises
    ------
    LLMUnavailable: no credentials.
    LLMError: unreachable, or the response was not usable JSON after retries.
    """
    chosen = model or settings.extraction_model

    try:
        if settings.llm_provider == "gemini":
            raw = await _gemini_json(system, user, schema, chosen, temperature, max_tokens)
        else:
            raw = await _openai_json(system, user, schema, chosen, temperature, max_tokens)
    except LLMUnavailable:
        raise
    except Exception as exc:  # noqa: BLE001 - normalise every SDK's error type
        raise LLMError(f"{settings.llm_provider} call failed: {exc}") from exc

    try:
        parsed = json.loads(_strip_fences(raw))
    except json.JSONDecodeError as exc:
        # Structured output is constrained, not guaranteed. A malformed payload
        # is retried; if it survives three attempts the caller decides what a
        # missing result means, which is always "we learned nothing", never a
        # fabricated default.
        log.warning("llm: unparseable JSON (%d chars): %s", len(raw), raw[:200])
        raise LLMError("model returned malformed JSON") from exc

    if not isinstance(parsed, dict):
        raise LLMError(f"model returned {type(parsed).__name__}, expected an object")
    return parsed


# --------------------------------------------------------------------------
# Gemini schema translation
# --------------------------------------------------------------------------

#: JSON Schema keywords Gemini's OpenAPI 3.0 subset rejects outright.
#:
#: ``additionalProperties`` is the one that bites first: every model here
#: inherits ``Base``, which sets ``extra="forbid"``, and Pydantic renders that
#: as ``"additionalProperties": false``. The API answers with
#: ``Unknown name "additional_properties"`` and the whole extraction returns
#: nulls. Passing the Pydantic class straight to ``response_schema`` does not
#: help — the SDK derives the same schema and emits the same key.
_GEMINI_UNSUPPORTED = frozenset(
    {
        "additionalProperties",
        "$defs",
        "definitions",
        "$schema",
        "$id",
        "title",
        "default",
        "examples",
        "const",
        "discriminator",
        "readOnly",
        "writeOnly",
        "patternProperties",
        "unevaluatedProperties",
    }
)


def _inline_schema(node: Any, defs: dict[str, Any], seen: frozenset[str]) -> Any:
    """One node of a JSON Schema, rewritten into Gemini's dialect.

    Three transformations, all of them necessary rather than cosmetic:

    * ``$ref`` is inlined from ``$defs``. Gemini has no reference resolver, so
      an enum like ``TenantProfile`` arrives as a dangling pointer otherwise.
    * ``anyOf: [X, {"type": "null"}]`` — how Pydantic v2 spells ``X | None`` —
      collapses to ``X`` plus ``nullable: true``, which Gemini does understand.
    * Unsupported keywords are dropped.

    ``seen`` guards against a self-referencing model looping forever. Nothing in
    this codebase is recursive today, but a schema walker that can hang on one
    is a poor thing to leave lying around.
    """
    if isinstance(node, list):
        return [_inline_schema(item, defs, seen) for item in node]
    if not isinstance(node, dict):
        return node

    if "$ref" in node:
        name = node["$ref"].rsplit("/", 1)[-1]
        if name in seen:
            # A cycle. Gemini cannot express one, and a permissive string beats
            # either infinite recursion or a schema it will reject.
            return {"type": "string"}
        return _inline_schema(defs.get(name, {}), defs, seen | {name})

    if "anyOf" in node:
        variants = [v for v in node["anyOf"] if v.get("type") != "null"]
        nullable = len(variants) != len(node["anyOf"])

        if len(variants) == 1:
            resolved = _inline_schema(variants[0], defs, seen)
            if isinstance(resolved, dict):
                if nullable:
                    resolved["nullable"] = True
                # The description sits on the union, not the variant, so it
                # would be lost in the collapse — and it is the only hint the
                # model gets about what the field means.
                if "description" in node:
                    resolved.setdefault("description", node["description"])
            return resolved

        collapsed: dict[str, Any] = {
            "anyOf": [_inline_schema(v, defs, seen) for v in variants]
        }
        if nullable:
            collapsed["nullable"] = True
        if "description" in node:
            collapsed["description"] = node["description"]
        return collapsed

    return {
        key: _inline_schema(value, defs, seen)
        for key, value in node.items()
        if key not in _GEMINI_UNSUPPORTED
    }


def gemini_schema(schema: dict[str, Any]) -> dict[str, Any]:
    """A Pydantic JSON Schema, translated into what Gemini will accept."""
    defs = schema.get("$defs") or schema.get("definitions") or {}
    return _inline_schema(schema, defs, frozenset())


async def _gemini_json(
    system: str, user: str, schema: dict[str, Any], model: str, temp: float, max_tokens: int
) -> str:
    from google.genai import types

    response = await _gemini().aio.models.generate_content(
        model=model,
        contents=user,
        config=types.GenerateContentConfig(
            system_instruction=system,
            response_mime_type="application/json",
            response_schema=gemini_schema(schema),
            temperature=temp,
            max_output_tokens=max_tokens,
        ),
    )
    return response.text or ""


async def _openai_json(
    system: str, user: str, schema: dict[str, Any], model: str, temp: float, max_tokens: int
) -> str:
    response = await _openai().chat.completions.create(
        model=model,
        messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
        response_format={
            "type": "json_schema",
            "json_schema": {"name": "result", "strict": True, "schema": schema},
        },
        temperature=temp,
        max_tokens=max_tokens,
    )
    return response.choices[0].message.content or ""


async def complete_model(
    *, system: str, user: str, output: type[TModel], model: str | None = None, **kwargs: Any
) -> TModel:
    """``complete_json`` that validates into a Pydantic model.

    Validation failure is an ``LLMError``, not a partially-populated object: a
    half-parsed result is the kind of thing that produces a listing with a rent
    and no idea where it came from.
    """
    schema = output.model_json_schema()
    data = await complete_json(system=system, user=user, schema=schema, model=model, **kwargs)
    try:
        return output.model_validate(data)
    except ValidationError as exc:
        log.warning("llm: response failed %s validation: %s", output.__name__, exc)
        raise LLMError(f"response did not match {output.__name__}") from exc


async def stream_text(
    *,
    system: str,
    user: str,
    model: str | None = None,
    temperature: float = 0.0,
    max_tokens: int = 2048,
) -> AsyncIterator[str]:
    """Yield an answer in pieces as the model produces it.

    Plain prose, not schema-constrained JSON. Streaming structured output means
    the client receives half-formed JSON it cannot parse until the end, which
    buys nothing — the point of streaming is that a person can start reading.

    Gemini only. OpenAI streams too, but nothing calls this on that path yet and
    an untested branch is worse than an honest refusal.
    """
    async for piece in generate_stream(
        user,
        system,
        model=model,
        temperature=temperature,
        max_tokens=max_tokens,
    ):
        yield piece
    return

    # unreachable; kept so the original single-provider path stays readable
    from google.genai import types

    chosen = model or settings.extraction_model
    stream = await _gemini().aio.models.generate_content_stream(
        model=chosen,
        contents=user,
        config=types.GenerateContentConfig(
            system_instruction=system,
            temperature=temperature,
            max_output_tokens=max_tokens,
            # Automatic function calling on a raw generation stream makes
            # the SDK warn and can stall the iterator waiting on a tool
            # round-trip that is never coming. No tools are declared here,
            # so it is turned off rather than left to warn on every chunk.
            automatic_function_calling=types.AutomaticFunctionCallingConfig(
                disable=True
            ),
        ),
    )
    async for chunk in stream:
        text = getattr(chunk, "text", None)
        if text:
            yield text


# --------------------------------------------------------------------------
# unified streaming with failover
# --------------------------------------------------------------------------


async def _anthropic_stream(
    system: str, user: str, model: str, temp: float, max_tokens: int
) -> AsyncIterator[str]:
    """Claude, streamed. Yields text deltas only."""
    async with _anthropic().messages.stream(
        model=model or settings.anthropic_model,
        max_tokens=max_tokens,
        temperature=temp,
        system=system,
        messages=[{"role": "user", "content": user}],
    ) as stream:
        async for piece in stream.text_stream:
            if piece:
                yield piece


async def _gemini_stream(
    system: str, user: str, model: str, temp: float, max_tokens: int
) -> AsyncIterator[str]:
    """Gemini, streamed, through the chat interface.

    ``chats.create(...).send_message_stream`` rather than
    ``generate_content_stream``: the latter runs automatic function calling on a
    raw generation stream, which the SDK warns about and which can stall the
    iterator waiting on a tool round-trip that is never coming.
    """
    from google.genai import types

    chat = _gemini().aio.chats.create(
        model=model or settings.extraction_model,
        config=types.GenerateContentConfig(
            system_instruction=system,
            temperature=temp,
            max_output_tokens=max_tokens,
        ),
    )
    async for chunk in await chat.send_message_stream(user):
        text = getattr(chunk, "text", None)
        if text:
            yield text


async def generate_stream(
    prompt: str,
    system_instruction: str = "",
    *,
    model: str | None = None,
    temperature: float = 0.0,
    max_tokens: int = 2048,
) -> AsyncIterator[str]:
    """Stream a completion, whichever provider is able to serve it.

    Claude first when a key is configured, Gemini otherwise and on failover.
    Chunks look identical either way, so nothing downstream knows or cares which
    one answered.

    The failover only fires **before the first chunk**. Once text has reached the
    reader, switching providers mid-answer would splice two different completions
    into one paragraph — so a mid-stream failure is surfaced rather than papered
    over with a second opinion.
    """
    primary_is_anthropic = settings.llm_provider == "anthropic" and anthropic_available()

    if primary_is_anthropic:
        started = False
        try:
            async for piece in _anthropic_stream(
                system_instruction, prompt, model or "", temperature, max_tokens
            ):
                started = True
                yield piece
            return
        except Exception as exc:  # noqa: BLE001 - normalise every SDK's error type
            if started or not (settings.llm_failover and _is_retryable(exc)):
                raise LLMError(f"anthropic stream failed: {exc}") from exc
            log.warning("llm: anthropic unavailable (%s) — falling back to gemini", exc)

    try:
        async for piece in _gemini_stream(
            system_instruction, prompt, model or "", temperature, max_tokens
        ):
            yield piece
    except Exception as exc:  # noqa: BLE001
        raise LLMError(f"gemini stream failed: {exc}") from exc
