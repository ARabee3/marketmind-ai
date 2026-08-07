"""Typed prompt/input assembly for the Strategy Agent.

Builds provenance-aware prompt payloads for the generation and revision endpoints
and records prompt/model/contract/configuration version metadata.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from strategy_contracts import (
    BudgetScenario,
    DeterministicChannelScorecard,
    KpiTarget,
    StrategyGenerateRequest,
    StrategyReviseRequest,
)
from orchestration_contracts import ResearchPackV1

from app.strategy.prompts import (
    STRATEGY_GENERATE_SYSTEM_PROMPT,
    STRATEGY_RESEARCH_HANDOFF_SYSTEM_PROMPT,
    STRATEGY_REVISE_SYSTEM_PROMPT,
    build_generate_user_context,
    build_revise_user_context,
)
from app.strategy.prompt_versions import (
    STRATEGY_GENERATE_PROMPT_VERSION,
    STRATEGY_REFERENCE_PATTERN_VERSION,
    STRATEGY_RESEARCH_HANDOFF_PROMPT_VERSION,
    STRATEGY_REVISE_PROMPT_VERSION,
)


@dataclass
class DecisionBundle:
    """Deterministic decision outputs that the model must explain but not change."""

    channel_scores: list[DeterministicChannelScorecard]
    budget_scenarios: list[BudgetScenario] | None = None
    kpi_targets: list[KpiTarget] | None = None


@dataclass
class PromptAssembly:
    """A complete prompt payload plus reproducible metadata."""

    system_prompt: str
    user_prompt: str
    metadata: dict[str, Any]


def _channel_scores_to_dicts(
    scorecards: list[DeterministicChannelScorecard],
) -> list[dict[str, Any]]:
    """Serialize deterministic channel scores without losing provenance."""
    return [scorecard.model_dump(mode="json", exclude_none=True) for scorecard in scorecards]


def _budget_scenarios_to_dicts(
    scenarios: list[BudgetScenario] | None,
) -> list[dict[str, Any]]:
    if scenarios is None:
        return []
    return [scenario.model_dump(mode="json", exclude_none=True) for scenario in scenarios]


def _kpi_targets_to_dicts(
    targets: list[KpiTarget] | None,
) -> list[dict[str, Any]]:
    if targets is None:
        return []
    return [target.model_dump(mode="json", exclude_none=True) for target in targets]


def _verify_input_consistency(request: StrategyGenerateRequest) -> None:
    """Ensure the supplied inputs reference the same immutable profile and brief.

    Raises ValueError if profile, brief, and retrieval pack disagree. The
    downstream validation pipeline will repeat these checks more thoroughly;
    this early guard prevents building an obviously inconsistent prompt.
    """
    brief_profile_id = request.brief.business_profile_version.business_profile_version_id
    brief_profile_version = request.brief.business_profile_version.version
    profile_id = request.business_profile.id
    profile_version = request.business_profile.version
    pack_profile_id = request.retrieved_knowledge_pack.profile_version_id

    if brief_profile_id != profile_id or brief_profile_version != profile_version:
        raise ValueError(
            "Strategy brief references a different business profile version than the payload."
        )
    if pack_profile_id != profile_id:
        raise ValueError(
            "Retrieved knowledge pack references a different business profile than the payload."
        )


def _build_metadata(
    request: StrategyGenerateRequest,
    prompt_version: str,
    provider_name: str,
    model: str,
) -> dict[str, Any]:
    """Record prompt, provider, contract, and reference-pattern versions."""
    return {
        "prompt_version": prompt_version,
        "provider_name": provider_name,
        "model": model,
        "contract_version": "strategy-v1",
        "reference_pattern_version": STRATEGY_REFERENCE_PATTERN_VERSION,
        "assembled_at": datetime.now(timezone.utc).isoformat(),
        "strategy_id": request.strategy_id,
        "brief_id": request.brief.id,
        "retrieval_run_id": request.retrieved_knowledge_pack.retrieval_run_id,
        "profile_version_id": request.business_profile.id,
        "profile_version": request.business_profile.version,
        "profile_confirmed_at": request.business_profile.confirmed_at.isoformat(),
        "channel_score_rule_version": "strategy-channel-score-v1",
        "language_mode": request.brief.plan_language,
        "budget_mode": request.brief.external_budget_mode,
        "paid_media_allowed": request.brief.paid_media_allowed,
        "primary_objective": request.brief.primary_objective,
        "business_type": request.retrieved_knowledge_pack.query_context.business_type,
        "funnel_stage": request.retrieved_knowledge_pack.query_context.funnel_stage,
        "retrieved_knowledge_pack_items": [
            item.model_dump(mode="json") for item in request.retrieved_knowledge_pack.items
        ],
    }


def assemble_generation_prompt(
    request: StrategyGenerateRequest,
    decision_bundle: DecisionBundle,
    provider_name: str,
    model: str,
    research_pack: ResearchPackV1 | None = None,
) -> PromptAssembly:
    """Assemble a provenance-aware prompt for Strategy generation."""
    _verify_input_consistency(request)

    channel_scores = _channel_scores_to_dicts(decision_bundle.channel_scores)
    budget_scenarios = _budget_scenarios_to_dicts(decision_bundle.budget_scenarios)
    kpi_targets = _kpi_targets_to_dicts(decision_bundle.kpi_targets)

    user_prompt = build_generate_user_context(
        request=request,
        channel_scores=channel_scores,
        budget_scenarios=budget_scenarios,
        kpi_targets=kpi_targets,
        research_pack=research_pack,
    )

    metadata = _build_metadata(
        request,
        STRATEGY_GENERATE_PROMPT_VERSION,
        provider_name,
        model,
    )
    if research_pack is not None:
        metadata["research_run_id"] = research_pack.run_id
        metadata["research_stop_reason"] = research_pack.stop_reason
        metadata["research_handoff_prompt_version"] = (
            STRATEGY_RESEARCH_HANDOFF_PROMPT_VERSION
        )

    system_prompt = STRATEGY_GENERATE_SYSTEM_PROMPT
    if research_pack is not None:
        system_prompt = f"{system_prompt}\n\n{STRATEGY_RESEARCH_HANDOFF_SYSTEM_PROMPT}"

    return PromptAssembly(
        system_prompt=system_prompt,
        user_prompt=user_prompt,
        metadata={
            **metadata,
            "deterministic_budget_scenarios": budget_scenarios,
            "deterministic_kpi_targets": kpi_targets,
        },
    )


def assemble_revision_prompt(
    request: StrategyReviseRequest,
    decision_bundle: DecisionBundle,
    provider_name: str,
    model: str,
) -> PromptAssembly:
    """Assemble a provenance-aware prompt for Strategy revision.

    The previous plan is included in the user context as read-only context.
    """
    _verify_input_consistency(request)

    channel_scores = _channel_scores_to_dicts(decision_bundle.channel_scores)
    budget_scenarios = _budget_scenarios_to_dicts(decision_bundle.budget_scenarios)
    kpi_targets = _kpi_targets_to_dicts(decision_bundle.kpi_targets)

    user_prompt = build_revise_user_context(
        request=request,
        channel_scores=channel_scores,
        budget_scenarios=budget_scenarios,
        kpi_targets=kpi_targets,
    )

    metadata = _build_metadata(
        request,
        STRATEGY_REVISE_PROMPT_VERSION,
        provider_name,
        model,
    )
    metadata["revision_notes"] = request.revision_notes
    metadata["previous_plan_version"] = request.previous_plan.version

    return PromptAssembly(
        system_prompt=STRATEGY_REVISE_SYSTEM_PROMPT,
        user_prompt=user_prompt,
        metadata={
            **metadata,
            "deterministic_budget_scenarios": budget_scenarios,
            "deterministic_kpi_targets": kpi_targets,
        },
    )
