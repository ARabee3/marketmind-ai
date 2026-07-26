"""LLM provider adapters for Strategy generation and revision.

Follows the same pattern as the Discovery providers but with a Strategy-specific
interface and output schema.
"""

from __future__ import annotations

import copy
import json
import uuid
from abc import ABC, abstractmethod
from datetime import datetime, timezone
from typing import Any

from anyio import to_thread
from pydantic import ValidationError

from strategy_contracts import BusinessProfileVersionRef, StrategyPlan

from app.core.config import Settings
from app.providers.base import ProviderConfigError, ProviderError
from app.strategy.assembler import PromptAssembly
from app.strategy.fixtures import load_default_plan_fixture


class StrategyLLMProvider(ABC):
    """Provider that turns a Strategy prompt assembly into a StrategyPlan."""

    name: str

    @abstractmethod
    async def generate_strategy_plan(self, prompt: PromptAssembly) -> StrategyPlan:
        """Return a parsed StrategyPlan for the given prompt."""
        raise NotImplementedError


# ---------------------------------------------------------------------------
# OpenAI provider
# ---------------------------------------------------------------------------

class OpenAIStrategyProvider(StrategyLLMProvider):
    name = "openai"

    def __init__(self, api_key: str, model: str, timeout_seconds: float) -> None:
        self.api_key = api_key
        self.model = model
        self.timeout_seconds = timeout_seconds

    async def generate_strategy_plan(self, prompt: PromptAssembly) -> StrategyPlan:
        if not self.api_key:
            raise ProviderConfigError("OPENAI_API_KEY is required for AI_PROVIDER_MODE=openai.")
        if not self.model:
            raise ProviderConfigError("OPENAI_MODEL is required for AI_PROVIDER_MODE=openai.")

        def call_openai() -> StrategyPlan:
            try:
                from openai import OpenAI
            except ImportError as exc:
                raise ProviderConfigError("The openai package is not installed.") from exc

            client = OpenAI(api_key=self.api_key, timeout=self.timeout_seconds)
            response = client.responses.parse(
                model=self.model,
                input=[
                    {"role": "system", "content": prompt.system_prompt},
                    {"role": "user", "content": prompt.user_prompt},
                ],
                text_format=StrategyPlan,
            )
            parsed = response.output_parsed
            if parsed is None:
                raise ProviderError(
                    "AI_PROVIDER_INVALID_OUTPUT",
                    "OpenAI returned no parsed output.",
                    retryable=False,
                )
            try:
                return StrategyPlan.model_validate(parsed)
            except ValidationError as exc:
                raise ProviderError(
                    "AI_PROVIDER_INVALID_OUTPUT",
                    f"OpenAI output failed schema validation: {exc}",
                    retryable=False,
                ) from exc

        try:
            return await to_thread.run_sync(call_openai)
        except ProviderError:
            raise
        except Exception as exc:
            raise ProviderError(
                "AI_PROVIDER_FAILURE",
                "OpenAI provider call failed.",
                retryable=True,
            ) from exc


# ---------------------------------------------------------------------------
# Gemini provider
# ---------------------------------------------------------------------------

_ALLOWED_JSON_SCHEMA_KEYS: frozenset[str] = frozenset({
    "type", "properties", "items", "required",
    "enum", "anyOf", "allOf", "oneOf", "$ref", "nullable",
    "minLength", "maxLength", "minimum", "maximum", "minItems", "maxItems",
    "pattern", "format", "description", "title", "default",
})


def _resolve_refs(
    schema: dict[str, Any],
    defs: dict[str, Any],
    visited: set[str] | None = None,
) -> dict[str, Any]:
    """Recursively inline ``$ref`` references from ``$defs``.

    Gemini's response-schema parser does not support ``$ref`` or ``$defs``,
    so every ``{"$ref": "#/$defs/SomeType"}`` must be replaced by the actual
    definition.
    """
    if visited is None:
        visited = set()

    if "$ref" in schema:
        ref = schema["$ref"]
        if ref.startswith("#/$defs/"):
            key = ref[len("#/$defs/"):]
            if key not in defs or key in visited:
                return schema
            visited.add(key)
            resolved: dict[str, Any] = _resolve_refs(defs[key], defs, visited)
            # Copy over any sibling keys (e.g. description)
            for k, v in schema.items():
                if k != "$ref":
                    resolved[k] = v
            visited.discard(key)
            return resolved
        return schema

    result: dict[str, Any] = {}
    for k, v in schema.items():
        if k == "$defs":
            continue
        if isinstance(v, dict):
            result[k] = _resolve_refs(v, defs, visited)
        elif isinstance(v, list):
            result[k] = [
                _resolve_refs(item, defs, visited) if isinstance(item, dict) else item
                for item in v
            ]
        else:
            result[k] = v
    return result


def _infer_items_from_prefix(schema: dict[str, Any]) -> None:
    """Convert Pydantic ``prefixItems`` (tuple notation) to a plain ``items``.

    Gemini's response-schema parser supports a single ``items`` for arrays,
    not ``prefixItems``.  If an array dict has ``prefixItems`` but no
    ``items``, we infer ``items`` from the first entry.  This is a lossy
    but sufficient conversion — the client-side Pydantic validation catches
    any mismatch.
    """
    if isinstance(schema.get("prefixItems"), list) and "items" not in schema:
        items = schema["prefixItems"][0] if schema["prefixItems"] else {"type": "string"}
        schema["items"] = copy.deepcopy(items)
    for value in list(schema.values()):
        if isinstance(value, dict):
            _infer_items_from_prefix(value)
        elif isinstance(value, list):
            for item in value:
                if isinstance(item, dict):
                    _infer_items_from_prefix(item)


def _strip_additional_properties(schema: dict[str, Any]) -> dict[str, Any]:
    """Resolve ``$ref`` references and remove Pydantic-specific schema fields.

    Pydantic's ``model_json_schema()`` emits extra keys such as
    ``exclusiveMinimum``, ``prefixItems``, and ``additionalProperties``
    that Gemini's response-schema parser does not allow.
    """
    # 0. Convert prefixItems to items before anything gets stripped
    _infer_items_from_prefix(schema)

    # 1. Capture $defs before they get stripped, then resolve $ref references
    defs = schema.pop("$defs", {})
    if defs:
        schema = _resolve_refs(schema, defs)

    # 2. Strip non-allowed keys
    allowed = _ALLOWED_JSON_SCHEMA_KEYS
    for key in list(schema):
        if key not in allowed:
            schema.pop(key)
    for key, value in list(schema.items()):
        if key == "properties" and isinstance(value, dict):
            for prop_schema in value.values():
                if isinstance(prop_schema, dict):
                    _strip_additional_properties(prop_schema)
        elif isinstance(value, dict):
            _strip_additional_properties(value)
        elif isinstance(value, list):
            for item in value:
                if isinstance(item, dict):
                    _strip_additional_properties(item)
    return schema


class GeminiStrategyProvider(StrategyLLMProvider):
    name = "gemini_dev"

    def __init__(self, api_key: str, model: str, timeout_ms: int) -> None:
        self.api_key = api_key
        self.model = model
        self.timeout_ms = timeout_ms

    async def generate_strategy_plan(self, prompt: PromptAssembly) -> StrategyPlan:
        if not self.api_key:
            raise ProviderConfigError("GEMINI_API_KEY is required for AI_PROVIDER_MODE=gemini_dev.")
        if not self.model:
            raise ProviderConfigError("GEMINI_MODEL is required for AI_PROVIDER_MODE=gemini_dev.")

        def call_gemini() -> StrategyPlan:
            try:
                from google import genai
                from google.genai import types
            except ImportError as exc:
                raise ProviderConfigError("The google-genai package is not installed.") from exc

            schema = _strip_additional_properties(StrategyPlan.model_json_schema())
            client = genai.Client(api_key=self.api_key)
            response = client.models.generate_content(
                model=self.model,
                contents=[prompt.user_prompt],
                config=types.GenerateContentConfig(
                    system_instruction=prompt.system_prompt,
                    response_mime_type="application/json",
                    response_schema=schema,
                    http_options=types.HttpOptions(timeout=self.timeout_ms),
                ),
            )
            raw_text = response.text or "{}"
            try:
                parsed = json.loads(raw_text)
            except json.JSONDecodeError as exc:
                raise ProviderError(
                    "AI_PROVIDER_INVALID_OUTPUT",
                    f"Gemini returned invalid JSON: {exc}",
                    retryable=False,
                ) from exc
            try:
                return StrategyPlan.model_validate(parsed)
            except ValidationError as exc:
                raise ProviderError(
                    "AI_PROVIDER_INVALID_OUTPUT",
                    f"Gemini output failed schema validation: {exc}",
                    retryable=False,
                ) from exc

        try:
            return await to_thread.run_sync(call_gemini)
        except ProviderError:
            raise
        except Exception as exc:
            raise ProviderError(
                "AI_PROVIDER_FAILURE",
                "Gemini provider call failed.",
                retryable=True,
            ) from exc


# ---------------------------------------------------------------------------
# Mock provider
# ---------------------------------------------------------------------------

class MockStrategyProvider(StrategyLLMProvider):
    """Deterministic provider that returns a valid fixture plan.

    Overwrites the fixture's identifiers from the prompt metadata so the
    response is consistent with the request. No paid provider calls.
    """

    name = "mock"

    def __init__(self, fixture_plan: StrategyPlan | None = None) -> None:
        self.fixture_plan = fixture_plan or load_default_plan_fixture()

    async def generate_strategy_plan(self, prompt: PromptAssembly) -> StrategyPlan:
        meta = prompt.metadata
        now = datetime.now(timezone.utc)

        is_revision = bool(meta.get("revision_notes"))
        previous_version = meta.get("previous_plan_version", 0)
        plan_version = previous_version + 1 if is_revision else 1

        profile_version = BusinessProfileVersionRef(
            business_profile_version_id=meta["profile_version_id"],
            confirmed_at=datetime.fromisoformat(meta["profile_confirmed_at"]),
            version=meta["profile_version"],
        )
        return self.fixture_plan.model_copy(
            update={
                "id": str(uuid.uuid5(uuid.NAMESPACE_DNS, f"strategy:{meta['strategy_id']}:v{plan_version}")),
                "strategy_id": meta["strategy_id"],
                "version": plan_version,
                "brief_id": meta["brief_id"],
                "profile_version": profile_version,
                "retrieval_run_id": meta["retrieval_run_id"],
                "created_at": now,
            }
        )


# ---------------------------------------------------------------------------
# Factory
# ---------------------------------------------------------------------------

def create_strategy_provider(settings: Settings) -> StrategyLLMProvider:
    if settings.ai_provider_mode == "openai":
        return OpenAIStrategyProvider(
            api_key=settings.openai_api_key,
            model=settings.openai_model,
            timeout_seconds=settings.ai_request_timeout_ms / 1000,
        )
    if settings.ai_provider_mode == "gemini_dev":
        return GeminiStrategyProvider(
            api_key=settings.gemini_api_key,
            model=settings.gemini_model,
            timeout_ms=settings.ai_request_timeout_ms,
        )
    return MockStrategyProvider()
