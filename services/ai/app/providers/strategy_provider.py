"""LLM provider adapters for Strategy generation and revision.

Follows the same pattern as the Discovery providers but with a Strategy-specific
interface and output schema.
"""

from __future__ import annotations

import copy
import json
import uuid
from abc import ABC, abstractmethod
from datetime import UTC, datetime
from typing import Any

from anyio import to_thread
from pydantic import ValidationError
from strategy_contracts import (
    BusinessProfileVersionRef,
    DeterministicChannelScorecard,
    KpiTarget,
    StrategyPlan,
    StrategyPlanV2,
)

from app.core.config import Settings
from app.providers.base import ProviderConfigError, ProviderError
from app.strategy.assembler import PromptAssembly
from app.strategy.content_handoff import (
    capability_state_for_choice,
    project_content_handoff,
)
from app.strategy.fixtures import (
    load_default_plan_fixture,
    load_default_plan_v2_fixture,
)


StrategyOutputModel = type[StrategyPlan] | type[StrategyPlanV2]


class StrategyLLMProvider(ABC):
    """Provider that turns a Strategy prompt assembly into a StrategyPlan."""

    name: str

    @abstractmethod
    async def generate_strategy_plan(
        self,
        prompt: PromptAssembly,
        output_model: StrategyOutputModel = StrategyPlan,
    ) -> StrategyPlan | StrategyPlanV2:
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

    async def generate_strategy_plan(
        self,
        prompt: PromptAssembly,
        output_model: StrategyOutputModel = StrategyPlan,
    ) -> StrategyPlan | StrategyPlanV2:
        if not self.api_key:
            raise ProviderConfigError("OPENAI_API_KEY is required for AI_PROVIDER_MODE=openai.")
        if not self.model:
            raise ProviderConfigError("OPENAI_MODEL is required for AI_PROVIDER_MODE=openai.")

        def call_openai() -> StrategyPlan | StrategyPlanV2:
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
                text_format=output_model,
            )
            parsed = response.output_parsed
            if parsed is None:
                raise ProviderError(
                    "AI_PROVIDER_INVALID_OUTPUT",
                    "OpenAI returned no parsed output.",
                    retryable=False,
                )
            try:
                return output_model.model_validate(parsed)
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

    # 1b. Gemini's response-schema parser accepts anyOf but not oneOf; unions
    # (e.g. discriminated unions) emit oneOf and must be converted.
    if "oneOf" in schema:
        if "anyOf" not in schema:
            schema["anyOf"] = schema["oneOf"]
        schema.pop("oneOf")

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


def _deterministic_scores_from_prompt(
    prompt: PromptAssembly,
) -> list[DeterministicChannelScorecard]:
    raw_scores = prompt.metadata.get("deterministic_channel_scores")
    if not isinstance(raw_scores, list):
        return []
    return [DeterministicChannelScorecard.model_validate(score) for score in raw_scores]


def _deterministic_kpi_targets_from_prompt(prompt: PromptAssembly) -> list[KpiTarget]:
    raw_targets = prompt.metadata.get("deterministic_kpi_targets")
    if not isinstance(raw_targets, list):
        return []
    return [KpiTarget.model_validate(target) for target in raw_targets]


def _normalize_deterministic_channel_scores(
    plan_dict: dict[str, Any],
    deterministic_channel_scores: list[DeterministicChannelScorecard],
) -> dict[str, Any]:
    if not deterministic_channel_scores:
        return plan_dict

    normalized = copy.deepcopy(plan_dict)
    rationales = _channel_rationales(normalized)
    normalized["channel_score_rule_version"] = "strategy-channel-score-v1"
    normalized["all_channel_scores"] = [
        _scorecard_with_rationale(scorecard, rationales)
        for scorecard in deterministic_channel_scores
    ]
    normalized["selected_channels"] = [
        _scorecard_with_rationale(scorecard, rationales)
        for scorecard in _selected_scorecards(normalized, deterministic_channel_scores)
    ]
    return normalized


def _normalize_deterministic_kpi_targets(
    plan_dict: dict[str, Any],
    deterministic_kpi_targets: list[KpiTarget],
) -> dict[str, Any]:
    if not deterministic_kpi_targets:
        return plan_dict
    normalized = copy.deepcopy(plan_dict)
    normalized["kpi_targets"] = [
        target.model_dump(mode="json", exclude_none=True)
        for target in deterministic_kpi_targets
    ]
    return normalized


def _normalize_deterministic_budget_scenarios(
    plan_dict: dict[str, Any],
    deterministic_budget_scenarios: list[dict[str, Any]],
    budget_mode: Any,
) -> dict[str, Any]:
    """Restore the owner-selected budget mode and its deterministic scenarios.

    Budget scenarios are calculated before the model is called.  They must not
    be invented or changed by a provider response; in particular, an
    ``organic_only`` brief must always persist ``null`` rather than a model-made
    paid scenario.  This mirrors the existing score and KPI normalization.
    """
    normalized = copy.deepcopy(plan_dict)
    budget_mode_value = str(getattr(budget_mode, "value", budget_mode))
    normalized["budget_mode"] = budget_mode_value
    if budget_mode_value == "organic_only":
        normalized["budget_scenarios"] = None
    else:
        normalized["budget_scenarios"] = deterministic_budget_scenarios
    return normalized


def _channel_rationales(plan_dict: dict[str, Any]) -> dict[str, dict[str, Any]]:
    rationales: dict[str, dict[str, Any]] = {}
    for field in ("all_channel_scores", "selected_channels"):
        values = plan_dict.get(field)
        if not isinstance(values, list):
            continue
        for value in values:
            if not isinstance(value, dict):
                continue
            channel = value.get("channel")
            rationale = value.get("rationale")
            if isinstance(channel, str) and isinstance(rationale, dict):
                rationales[channel] = rationale
    return rationales


def _scorecard_with_rationale(
    scorecard: DeterministicChannelScorecard,
    rationales: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    scorecard_data = scorecard.model_dump(mode="json")
    scorecard_data["rationale"] = rationales.get(
        scorecard.channel,
        {
            "text": f"{scorecard.channel} is based on deterministic channel scoring.",
            "source": "deterministic_result",
            "citation_ids": [],
        },
    )
    return scorecard_data


def _selected_scorecards(
    plan_dict: dict[str, Any],
    deterministic_channel_scores: list[DeterministicChannelScorecard],
) -> list[DeterministicChannelScorecard]:
    scorecards_by_channel = {
        scorecard.channel: scorecard for scorecard in deterministic_channel_scores
    }
    selected_names = [
        value.get("channel")
        for value in plan_dict.get("selected_channels", [])
        if isinstance(value, dict) and isinstance(value.get("channel"), str)
    ]
    selected = [
        scorecards_by_channel[name]
        for name in selected_names
        if name in scorecards_by_channel
        and scorecards_by_channel[name].excluded_reason is None
    ]
    if selected:
        candidates = selected
    else:
        candidates = [
            scorecard
            for scorecard in deterministic_channel_scores
            if scorecard.excluded_reason is None
        ]

    bounded: list[DeterministicChannelScorecard] = []
    primary_count = 0
    supporting_count = 0
    for scorecard in candidates:
        if scorecard.role.value == "primary":
            if primary_count >= 2:
                continue
            primary_count += 1
        else:
            if supporting_count >= 1:
                continue
            supporting_count += 1
        bounded.append(scorecard)
    return bounded


class GeminiStrategyProvider(StrategyLLMProvider):
    name = "gemini_dev"

    def __init__(self, api_key: str, model: str, timeout_ms: int) -> None:
        self.api_key = api_key
        self.model = model
        self.timeout_ms = timeout_ms

    async def generate_strategy_plan(
        self,
        prompt: PromptAssembly,
        output_model: StrategyOutputModel = StrategyPlan,
    ) -> StrategyPlan | StrategyPlanV2:
        if not self.api_key:
            raise ProviderConfigError("GEMINI_API_KEY is required for AI_PROVIDER_MODE=gemini_dev.")
        if not self.model:
            raise ProviderConfigError("GEMINI_MODEL is required for AI_PROVIDER_MODE=gemini_dev.")

        def call_gemini() -> StrategyPlan | StrategyPlanV2:
            try:
                from google import genai
                from google.genai import types
            except ImportError as exc:
                raise ProviderConfigError("The google-genai package is not installed.") from exc

            schema = _strip_additional_properties(output_model.model_json_schema())
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
                if output_model is StrategyPlanV2:
                    normalized = _normalize_v2_commitments_and_handoff(
                        parsed, prompt
                    )
                    return StrategyPlanV2.model_validate(normalized)
                normalized = _normalize_deterministic_channel_scores(
                    parsed,
                    _deterministic_scores_from_prompt(prompt),
                )
                normalized = _normalize_deterministic_kpi_targets(
                    normalized,
                    _deterministic_kpi_targets_from_prompt(prompt),
                )
                normalized = _normalize_deterministic_budget_scenarios(
                    normalized,
                    prompt.metadata.get("deterministic_budget_scenarios", []),
                    prompt.metadata.get("budget_mode"),
                )
                return StrategyPlan.model_validate(normalized)
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
                f"Gemini provider call failed: {exc}",
                retryable=True,
            ) from exc


# ---------------------------------------------------------------------------
# Strategy v2 deterministic normalization
# ---------------------------------------------------------------------------


def _default_commitment_rationale(channel: str, language: Any) -> dict[str, Any]:
    """Language-appropriate owner-input rationale for a commitment."""
    language_value = str(getattr(language, "value", language))
    if language_value == "ar-EG":
        text = f"قناة {channel} اختارها المالك؛ تلتزم الخطة بها كما هي."
    elif language_value == "en":
        text = f"The owner selected {channel}; the plan commits to it as chosen."
    else:
        text = (
            f"قناة {channel} اختارها المالك؛ تلتزم الخطة بها كما هي. / "
            f"The owner selected {channel}; the plan commits to it as chosen."
        )
    return {
        "text": text,
        "source": "owner_input",
        "citation_ids": [],
    }


def _normalize_v2_commitments_and_handoff(
    plan_dict: dict[str, Any],
    prompt: PromptAssembly,
) -> dict[str, Any]:
    """Enforce the owner-first invariant on a v2 plan dict.

    Channel, role, setup state, and capability state come from the brief's
    channel choices — the model can never add, replace, or drop a channel.
    Only the rationale text is taken from the model output. The content
    handoff is then projected deterministically from the calendar weeks.
    """
    normalized = copy.deepcopy(plan_dict)

    choices = prompt.metadata.get("channel_choices")
    if not isinstance(choices, list):
        choices = []

    model_commitments = normalized.get("channel_commitments")
    rationale_by_channel: dict[str, dict[str, Any]] = {}
    if isinstance(model_commitments, list):
        for commitment in model_commitments:
            if not isinstance(commitment, dict):
                continue
            channel = commitment.get("channel")
            rationale = commitment.get("rationale")
            if isinstance(channel, str) and isinstance(rationale, dict):
                rationale_by_channel[channel] = rationale

    language = normalized.get("plan_language", "ar-EG")
    commitments: list[dict[str, Any]] = []
    for choice in choices:
        if not isinstance(choice, dict):
            continue
        setup_state = choice.get("setup_state", "setup_later")
        publishing_target_id = choice.get("publishing_target_id")
        capability_state = (
            "publishing_ready"
            if setup_state == "connected" and publishing_target_id
            else "publishing_pending"
            if setup_state == "connected"
            else "owner_managed"
        )
        commitments.append(
            {
                "channel": choice["channel"],
                "role": choice.get("role", "supporting"),
                "setup_state": setup_state,
                "capability_state": capability_state,
                "rationale": rationale_by_channel.get(
                    choice["channel"],
                    _default_commitment_rationale(choice["channel"], language),
                ),
            }
        )
    normalized["channel_commitments"] = commitments

    calendar_weeks = normalized.get("calendar_weeks")
    selected_channels = [choice["channel"] for choice in choices if isinstance(choice, dict)]
    if isinstance(calendar_weeks, list):
        handoff = project_content_handoff(
            calendar_weeks=calendar_weeks,
            selected_channels=selected_channels,
            language=language,
        )
        normalized["content_handoff"] = handoff.model_dump(mode="json")
    return normalized


# ---------------------------------------------------------------------------
# Mock provider
# ---------------------------------------------------------------------------

class MockStrategyProvider(StrategyLLMProvider):
    """Deterministic provider that returns a valid fixture plan.

    Overwrites the fixture's identifiers from the prompt metadata so the
    response is consistent with the request. No paid provider calls.
    """

    name = "mock"

    def __init__(
        self,
        fixture_plan: StrategyPlan | None = None,
        fixture_plan_v2: StrategyPlanV2 | None = None,
    ) -> None:
        self.fixture_plan = fixture_plan or load_default_plan_fixture()
        self.fixture_plan_v2 = fixture_plan_v2 or load_default_plan_v2_fixture()

    async def generate_strategy_plan(
        self,
        prompt: PromptAssembly,
        output_model: StrategyOutputModel = StrategyPlan,
    ) -> StrategyPlan | StrategyPlanV2:
        meta = prompt.metadata
        now = datetime.now(UTC)

        if meta.get("contract_version") == "strategy-v2" or output_model is StrategyPlanV2:
            plan_dict = self.fixture_plan_v2.model_dump(mode="json")
            return self._rewrite_v2_plan(plan_dict, meta, now)

        return self._rewrite_v1_plan(prompt, meta, now)

    def _rewrite_v2_plan(
        self,
        plan_dict: dict[str, Any],
        meta: dict[str, Any],
        now: datetime,
    ) -> StrategyPlanV2:
        is_revision = bool(meta.get("revision_notes"))
        previous_version = meta.get("previous_plan_version", 0)
        plan_version = previous_version + 1 if is_revision else 1

        profile_version = BusinessProfileVersionRef(
            business_profile_version_id=meta["profile_version_id"],
            confirmed_at=datetime.fromisoformat(meta["profile_confirmed_at"]),
            version=meta["profile_version"],
        )

        plan_dict["id"] = str(uuid.uuid5(uuid.NAMESPACE_DNS, f"strategy:{meta['strategy_id']}:v{plan_version}"))
        plan_dict["strategy_id"] = meta["strategy_id"]
        plan_dict["version"] = plan_version
        plan_dict["brief_id"] = meta["brief_id"]
        plan_dict["profile_version"] = {
            "business_profile_version_id": profile_version.business_profile_version_id,
            "confirmed_at": profile_version.confirmed_at.isoformat(),
            "version": profile_version.version,
        }
        plan_dict["retrieval_run_id"] = meta["retrieval_run_id"]
        plan_dict["created_at"] = now.isoformat()

        language_mode = meta.get("language_mode")
        primary_objective = meta.get("primary_objective")
        funnel_stage = meta.get("funnel_stage")
        if language_mode is not None:
            language_mode_value = str(getattr(language_mode, "value", language_mode))
            plan_dict["plan_language"] = language_mode_value
            if language_mode_value == "en":
                _write_english_mock_owner_text_v2(plan_dict)
        if primary_objective is not None:
            plan_dict["primary_objective"] = str(
                getattr(primary_objective, "value", primary_objective)
            )
        if funnel_stage:
            plan_dict["funnel_stage"] = funnel_stage

        plan_dict = self._rewrite_citations(plan_dict, meta)
        plan_dict = _normalize_v2_commitments_and_handoff(plan_dict, PromptAssembly(
            system_prompt="",
            user_prompt="",
            metadata=meta,
        ))
        return StrategyPlanV2.model_validate(plan_dict)

    def _rewrite_v1_plan(
        self,
        prompt: PromptAssembly,
        meta: dict[str, Any],
        now: datetime,
    ) -> StrategyPlan:
        is_revision = bool(meta.get("revision_notes"))
        previous_version = meta.get("previous_plan_version", 0)
        plan_version = previous_version + 1 if is_revision else 1

        profile_version = BusinessProfileVersionRef(
            business_profile_version_id=meta["profile_version_id"],
            confirmed_at=datetime.fromisoformat(meta["profile_confirmed_at"]),
            version=meta["profile_version"],
        )

        pack_items = meta.get("retrieved_knowledge_pack_items") or []
        citations = []
        from strategy_contracts import EvidenceTier, PlanCitation

        for idx, item in enumerate(pack_items):
            citations.append(
                PlanCitation(
                    citation_id=f"c1000000-0000-4000-8000-00000000000{idx + 1}",
                    chunk_id=item["chunk_id"],
                    entry_id=item["entry_id"],
                    entry_version=item.get("entry_version", 1),
                    title=item.get("title", "Fixture Title"),
                    excerpt=item.get("excerpt", "Fixture excerpt content."),
                    evidence_tier=EvidenceTier(item["source_quality"]["evidence_tier"]),
                    relevance_score=item.get("relevance_score", 0.9),
                )
            )

        valid_citation_ids = {c.citation_id for c in citations}
        verified_benchmark_citation_ids = {
            c.citation_id for c in citations if c.evidence_tier == EvidenceTier.verified_benchmark
        }

        plan_dict = self.fixture_plan.model_dump(mode="json")
        plan_dict["id"] = str(uuid.uuid5(uuid.NAMESPACE_DNS, f"strategy:{meta['strategy_id']}:v{plan_version}"))
        plan_dict["strategy_id"] = meta["strategy_id"]
        plan_dict["version"] = plan_version
        plan_dict["brief_id"] = meta["brief_id"]
        plan_dict["profile_version"] = {
            "business_profile_version_id": profile_version.business_profile_version_id,
            "confirmed_at": profile_version.confirmed_at.isoformat(),
            "version": profile_version.version,
        }
        plan_dict["retrieval_run_id"] = meta["retrieval_run_id"]
        plan_dict["created_at"] = now.isoformat()
        plan_dict["citations"] = [c.model_dump(mode="json") for c in citations]
        business_type = meta.get("business_type")
        primary_objective = meta.get("primary_objective")
        language_mode = meta.get("language_mode")
        budget_mode = meta.get("budget_mode")
        funnel_stage = meta.get("funnel_stage")
        if business_type and primary_objective and language_mode and budget_mode:
            business_type_value = str(getattr(business_type, "value", business_type))
            primary_objective_value = str(getattr(primary_objective, "value", primary_objective))
            language_mode_value = str(getattr(language_mode, "value", language_mode))
            budget_mode_value = str(getattr(budget_mode, "value", budget_mode))
            context_text = (
                f"For {business_type_value}, objective {primary_objective_value}, "
                f"locale {language_mode_value}, budget {budget_mode_value}"
            )
            plan_dict["executive_summary"]["text"] = (
                f"{context_text}. {plan_dict['executive_summary']['text']}"
            )
            plan_dict["situation_diagnosis"]["text"] = (
                f"{context_text}. {plan_dict['situation_diagnosis']['text']}"
            )
            plan_dict["primary_objective"] = primary_objective_value
            plan_dict["plan_language"] = language_mode_value
            plan_dict["budget_mode"] = budget_mode_value
            budget_scenarios = meta.get("deterministic_budget_scenarios")
            if isinstance(budget_scenarios, list):
                plan_dict["budget_scenarios"] = budget_scenarios
            kpi_targets = meta.get("deterministic_kpi_targets")
            if isinstance(kpi_targets, list):
                plan_dict["kpi_targets"] = kpi_targets
            if language_mode_value == "en":
                _write_english_mock_owner_text(plan_dict)
            if budget_mode_value == "organic_only":
                plan_dict["budget_scenarios"] = None
            if funnel_stage:
                plan_dict["funnel_stage"] = funnel_stage

        def recursive_clean(val):
            if isinstance(val, dict):
                # SourcedClaim check
                if "source" in val and "citation_ids" in val:
                    cids = val.get("citation_ids") or []
                    new_cids = [cid for cid in cids if cid in valid_citation_ids]
                    new_source = val["source"]
                    if not new_cids and val["source"] == "retrieved_evidence":
                        new_source = "confirmed_fact"
                    val["citation_ids"] = new_cids
                    val["source"] = new_source
                # KpiTarget check
                if "target_mode" in val and "benchmark_citation_id" in val:
                    bcid = val.get("benchmark_citation_id")
                    if bcid and bcid not in verified_benchmark_citation_ids:
                        val["benchmark_citation_id"] = None
                        val["target_mode"] = "baseline_improvement"

                for v in val.values():
                    recursive_clean(v)
            elif isinstance(val, list):
                for item in val:
                    recursive_clean(item)

        recursive_clean(plan_dict)

        normalized = _normalize_deterministic_channel_scores(
            plan_dict,
            _deterministic_scores_from_prompt(prompt),
        )
        normalized = _normalize_deterministic_kpi_targets(
            normalized,
            _deterministic_kpi_targets_from_prompt(prompt),
        )
        return StrategyPlan.model_validate(normalized)

    def _rewrite_citations(
        self,
        plan_dict: dict[str, Any],
        meta: dict[str, Any],
    ) -> dict[str, Any]:
        """Rebuild citations and clean claim citation_ids for the v2 plan."""
        pack_items = meta.get("retrieved_knowledge_pack_items") or []
        citations = []
        from strategy_contracts import EvidenceTier, PlanCitation

        for idx, item in enumerate(pack_items):
            citations.append(
                PlanCitation(
                    citation_id=f"c1000000-0000-4000-8000-00000000000{idx + 1}",
                    chunk_id=item["chunk_id"],
                    entry_id=item["entry_id"],
                    entry_version=item.get("entry_version", 1),
                    title=item.get("title", "Fixture Title"),
                    excerpt=item.get("excerpt", "Fixture excerpt content."),
                    evidence_tier=EvidenceTier(item["source_quality"]["evidence_tier"]),
                    relevance_score=item.get("relevance_score", 0.9),
                )
            )
        valid_citation_ids = {c.citation_id for c in citations}
        plan_dict["citations"] = [c.model_dump(mode="json") for c in citations]

        def recursive_clean(val):
            if isinstance(val, dict):
                if "source" in val and "citation_ids" in val:
                    cids = val.get("citation_ids") or []
                    new_cids = [cid for cid in cids if cid in valid_citation_ids]
                    new_source = val["source"]
                    if not new_cids and val["source"] == "retrieved_evidence":
                        new_source = "confirmed_fact"
                    val["citation_ids"] = new_cids
                    val["source"] = new_source
                for v in val.values():
                    recursive_clean(v)
            elif isinstance(val, list):
                for item in val:
                    recursive_clean(item)

        recursive_clean(plan_dict)
        return plan_dict


def _write_english_mock_owner_text(plan: dict[str, Any]) -> None:
    """Keep deterministic mock output aligned with an English Strategy brief."""
    plan["executive_summary"]["text"] = (
        f"{plan['executive_summary']['text'].split('.', 1)[0]}. "
        "Focus the twelve-week plan on the channels the owner can sustain and review."
    )
    plan["situation_diagnosis"]["text"] = (
        f"{plan['situation_diagnosis']['text'].split('.', 1)[0]}. "
        "The business needs a consistent, evidence-led marketing rhythm."
    )
    plan["target_audience"]["text"] = (
        "Prioritize nearby customers who need a convenient, trustworthy offer."
    )
    plan["positioning"]["text"] = (
        "Position the business as a practical local choice with clear value and dependable service."
    )
    plan["tone"]["text"] = (
        "Use a helpful, direct, and confident tone without exaggerated claims."
    )

    for channel in plan["selected_channels"]:
        channel["rationale"]["text"] = (
            f"Use {channel['channel']} because it fits the confirmed owner capacity "
            "and available evidence."
        )
    for scenario in plan.get("budget_scenarios") or []:
        scenario["notes"]["text"] = (
            "Review this budget scenario with the owner before approving any paid activity."
        )
    for target in plan["kpi_targets"]:
        if target.get("target_value") and any(
            character.isalpha() for character in target["target_value"]
        ):
            target["target_value"] = (
                "Improve against the confirmed baseline over twelve weeks."
            )
        target["measurement_method"] = (
            "Review the channel's native insights every week."
        )
        target["notes"]["text"] = (
            "Compare the result with the confirmed baseline and record the learning."
        )
    for assumption in plan["assumptions"]:
        assumption["text"] = (
            "Test this assumption during the first two weeks before expanding the plan."
        )
    for risk in plan["risks"]:
        risk["text"] = (
            "The owner may need additional guidance to maintain the planned activity."
        )
    for gap in plan["knowledge_gaps"]:
        gap["description"] = (
            "Reliable local evidence is not yet available for this planning question."
        )
    for blocker in plan["blockers"]:
        blocker["message"] = (
            "Resolve this missing owner decision before approving the Strategy."
        )

    content = plan["content_strategy"]
    for index, pillar in enumerate(content["pillars"], start=1):
        pillar["text"] = (
            f"Content pillar {index}: explain a useful customer benefit with supporting evidence."
        )
    for index, item in enumerate(content["format_mix"], start=1):
        item["text"] = (
            f"Format option {index}: use a repeatable format the owner can produce consistently."
        )
    content["weekly_cadence"] = (
        "Publish three owner-reviewed pieces each week and review performance weekly."
    )
    for week in content["weeks"]:
        week["theme"] = f"Week {week['week_number']} learning theme"
        if week.get("notes"):
            week["notes"] = "Record the result and use it to adjust the next week."
    for experiment in content["experiments"]:
        experiment["hypothesis"] = (
            "A clearer evidence-led message will improve qualified customer response."
        )
        experiment["method"] = (
            "Compare two owner-approved variants over the planned test period."
        )
        experiment["success_criteria"] = (
            "The selected response metric improves against the confirmed baseline."
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


def _write_english_mock_owner_text_v2(plan: dict[str, Any]) -> None:
    """Keep deterministic v2 mock output aligned with an English brief."""
    plan["goal"]["text"] = (
        "Attract more lunch customers from nearby offices over twelve weeks using "
        "the channels the owner selected."
    )
    plan["evidence_summary"]["text"] = (
        "The plan relies on the confirmed business profile and the reviewed "
        "knowledge pack; unknown market facts are recorded as validation steps, "
        "never invented."
    )
    for week in plan["calendar_weeks"]:
        week["focus"] = f"Week {week['week_number']} focus"
        week["expected_outcome"] = "A clear, owner-manageable outcome for the week."
        week["measurement_check"] = "Check the weekly result in the channel insights."
    for item in plan["owner_advice"]["before_week_1"]:
        item["action"] = "Complete the setup of the selected channel."
        item["why_it_matters"] = "A complete channel profile builds the first impression."
        item["timing"] = "Within the first three days of the plan."
        item["source"]["text"] = (
            "Reviewed guidance: complete channel setup before the first publish."
        )
    for group in plan["owner_advice"]["weeks"]:
        for item in group["items"]:
            item["action"] = "Complete the week's owner-managed action."
            item["why_it_matters"] = "Small consistent owner actions build the plan's results."
            item["timing"] = "Before the end of the week."
            item["source"]["text"] = (
                "Owner-led advice grounded in the confirmed profile or reviewed guidance."
            )
    for risk in plan["risks"]:
        risk["text"] = (
            "The owner's limited weekly capacity may slow execution; keep the plan lean."
        )
    for gap in plan["knowledge_gaps"]:
        gap["description"] = (
            "Reliable local evidence is not yet available for this planning question."
        )
    for blocker in plan["blockers"]:
        blocker["message"] = (
            "Resolve this missing owner decision before approving the Strategy."
        )
