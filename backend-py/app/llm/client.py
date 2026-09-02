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
            response_schema=schema,
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
