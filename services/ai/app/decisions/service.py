"""Orchestrate deterministic scoring, selection, budget, KPI, and explanation."""

from __future__ import annotations

from typing import Any

from strategy_contracts import (
    BudgetScenario,
    BusinessProfilePayload,
    DeterministicChannelScorecard,
    ExternalBudgetMode,
    KpiTarget,
    StrategyBrief,
    calculate_channel_total,
)

from app.decisions.budget_arithmetic import compute_budget_scenarios
from app.decisions.channel_scoring import (
    DimensionResult,
    score_all_channels,
)
from app.decisions.channel_selection import select_channels
from app.decisions.config import STANDARD_CHANNELS
from app.decisions.explanations import (
    ChannelScoreExplanation,
    StrategyDecisionBundle,
    build_channel_explanation,
)
from app.decisions.kpi_modes import compute_kpi_targets
from app.decisions.normalize import normalize_inputs, normalize_inputs_v2
from app.rag.schemas import KnowledgeGap, RetrievedKnowledgePack


def compute_strategy_decisions(
    *,
    business_profile: BusinessProfilePayload,
    brief: StrategyBrief,
    retrieval_pack: RetrievedKnowledgePack,
    channels: tuple[str, ...] = STANDARD_CHANNELS,
) -> StrategyDecisionBundle:
    """
    Run the full deterministic pipeline:
    normalize inputs -> score all channels -> apply exclusions -> select 2+1 ->
    budget scenarios -> KPI targets -> structured explanations.
    """
    normalized = normalize_inputs(
        brief=brief,
        profile_payload=business_profile.profile,
    )

    scored, knowledge_gaps = score_all_channels(
        profile=business_profile.profile,
        brief=brief,
        retrieval_pack=retrieval_pack,
        normalized=normalized,
        channels=channels,
    )

    scorecards, selected = select_channels(scored)

    budget_scenarios = compute_budget_scenarios(
        brief=brief,
        normalized=normalized,
        selected_scorecards=selected,
    )
    if (
        brief.paid_media_allowed
        and brief.external_budget_mode == ExternalBudgetMode.scenario_only
        and normalized.budget_anchor_egp is None
    ):
        knowledge_gaps.append(
            KnowledgeGap(
                category="budget:paid_media",
                description="Budget must be confirmed before paid-media scenarios can be generated.",
                severity="blocking",
            )
        )

    primary_channels = [
        card.channel
        for card in selected
        if card.role.value == "primary"
    ][:2]
    kpi_targets = compute_kpi_targets(
        brief=brief,
        retrieval_pack=_adapt_pack(retrieval_pack),
        primary_channels=primary_channels,
    )

    explanations = _build_explanations(scored, scorecards)

    return StrategyDecisionBundle(
        channel_scorecards=scorecards,
        selected_channels=selected,
        channel_explanations=explanations,
        budget_scenarios=budget_scenarios,
        kpi_targets=kpi_targets,
        knowledge_gaps=[gap.model_dump(mode="json") for gap in knowledge_gaps],
    )


def _build_explanations(
    scored: list[tuple[str, Any, list[DimensionResult], float]],
    scorecards: list[DeterministicChannelScorecard],
) -> list[ChannelScoreExplanation]:
    """Map scorecards and dimension results back to explanations."""
    scorecard_by_channel = {card.channel: card for card in scorecards}
    explanations: list[ChannelScoreExplanation] = []
    for channel, _, dim_results, total in scored:
        card = scorecard_by_channel[channel]
        explanations.append(
            build_channel_explanation(
                channel=channel,
                dim_results=dim_results,
                total_score=total,
                excluded_reason=card.excluded_reason,
                role=card.role,
            )
        )
    return explanations


def compute_strategy_v2_decisions(
    *,
    business_profile: BusinessProfilePayload,
    brief: Any,
    retrieval_pack: RetrievedKnowledgePack,
) -> StrategyDecisionBundle:
    """Owner-first deterministic pipeline for strategy-v2 briefs.

    Scores ONLY the owner-selected channels. Roles and setup states come from
    the brief's channel choices — the pipeline never adds, replaces, or
    silently prioritizes a channel. Exclusions that would drop an owner choice
    are recorded as blockers instead of removed. Budget scenarios and KPI
    targets are intentionally not part of the v2 plan surface.
    """
    from strategy_contracts import (
        ChannelRole,
        DeterministicChannelScorecard,
    )

    normalized = normalize_inputs_v2(
        brief=brief,
        profile_payload=business_profile.profile,
    )

    channels = tuple(choice.channel.value for choice in brief.channel_choices)
    scored, knowledge_gaps = score_all_channels(
        profile=business_profile.profile,
        brief=brief,
        retrieval_pack=retrieval_pack,
        normalized=normalized,
        channels=channels,
    )

    role_by_channel = {
        choice.channel.value: choice.role.value for choice in brief.channel_choices
    }
    scorecards: list[DeterministicChannelScorecard] = []
    for channel, scores, _dim_results, total in scored:
        scorecards.append(
            DeterministicChannelScorecard(
                channel=channel,
                role=ChannelRole(
                    role_by_channel.get(channel, ChannelRole.supporting.value)
                ),
                scores=scores,
                total_score=total,
                excluded_reason=None,
            )
        )

    explanations = _build_explanations(scored, scorecards)

    return StrategyDecisionBundle(
        channel_scorecards=scorecards,
        selected_channels=scorecards,
        channel_explanations=explanations,
        budget_scenarios=None,
        kpi_targets=[],
        knowledge_gaps=[gap.model_dump(mode="json") for gap in knowledge_gaps],
    )


def _adapt_pack(pack: RetrievedKnowledgePack) -> Any:
    """Adapt the RAG service pack to the contract pack shape expected by KPI modes."""
    from strategy_contracts import (
        RetrievedKnowledgeItem as ContractItem,
        RetrievedKnowledgePack as ContractPack,
        RetrievalQueryContext as ContractQueryContext,
        SourceQuality,
    )

    contract_items = []
    for item in pack.items:
        source_quality = SourceQuality(
            evidence_tier=item.evidence_tier,
            source_references=item.source_references,
            effective_at=item.effective_at,
            expires_at=item.expires_at,
            review_status=item.review_status,  # type: ignore[arg-type]
        )
        contract_item = ContractItem(
            chunk_id=str(item.chunk_id),
            entry_id=str(item.entry_id),
            entry_version=item.entry_version,
            title=item.title,
            excerpt=item.excerpt,
            kind=item.kind,
            tags=item.tags,
            relevance_score=item.relevance_score,
            source_quality=source_quality,
        )
        contract_items.append(contract_item)

    return ContractPack(
        meta=pack.retrieval_metadata,
        retrieval_run_id=str(pack.retrieval_run_id),
        query_summary=pack.query_summary,
        query_context=ContractQueryContext(
            business_type=pack.query_context.get("business_type", ""),
            market=pack.query_context.get("market", ""),
            locale=pack.query_context.get("locale", ""),
            objective=pack.query_context.get("objective", ""),
            funnel_stage=pack.query_context.get("funnel_stage", "awareness"),
            active_channels=pack.query_context.get("active_channels", []),
            asset_capability=pack.query_context.get("asset_capability", []),
            team_capacity=pack.query_context.get("team_capacity", ""),
            budget_mode=pack.query_context.get("budget_mode", ""),
            industry=pack.query_context.get("industry"),
        ),
        profile_version_id=str(pack.profile_version_id),
        brief_id=str(pack.brief_id),
        items=contract_items,
        knowledge_gaps=[],
        retrieval_metadata=pack.retrieval_metadata,
        retrieved_at=pack.retrieved_at,
    )
