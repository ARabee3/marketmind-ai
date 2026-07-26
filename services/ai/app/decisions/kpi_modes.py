"""Deterministic KPI target mode selection."""

from __future__ import annotations

import re
import uuid
from typing import Any

from strategy_contracts import (
    ClaimSource,
    KpiTarget,
    KpiTargetMode,
    SourcedClaim,
    StrategyBrief,
    StrategyObjective,
    StrategyPlan,
)

from app.decisions.config import OBJECTIVE_KPI_METRICS
from app.rag.schemas import HydratedItem, RetrievedKnowledgePack

_NUMERIC_TARGET_PATTERN = re.compile(
    r"\b(\d[\d,]*(?:\.\d+)?)\s*(%|percent|followers|orders|leads|customers)?",
    re.IGNORECASE,
)


def _owner_stated_target(brief: StrategyBrief, metric: str) -> str | None:
    metric_lower = metric.lower()
    sources = list(brief.constraints) + [
        answer.answer_text for answer in brief.clarification_answers
    ]
    for text in sources:
        if metric_lower not in text.lower():
            continue
        match = _NUMERIC_TARGET_PATTERN.search(text)
        if match:
            return match.group(0).strip()
    for text in sources:
        match = _NUMERIC_TARGET_PATTERN.search(text)
        if match and metric_lower.split("_")[0] in text.lower():
            return match.group(0).strip()
    return None


def _item_evidence_tier(item: Any) -> str:
    """Handle both HydratedItem (flat) and contract item (source_quality)."""
    if hasattr(item, "evidence_tier"):
        return item.evidence_tier
    return item.source_quality.evidence_tier


def _item_tags(item: Any) -> dict[str, list[str]]:
    return item.tags


def _verified_benchmark_item(
    items: list[Any],
    *,
    metric: str,
    channel: str | None,
) -> Any | None:
    metric_lower = metric.lower()
    for item in items:
        if _item_evidence_tier(item) != "verified_benchmark":
            continue
        tags = _item_tags(item)
        item_metrics = [m.lower() for m in tags.get("metric", [])]
        item_channels = [c.lower() for c in tags.get("channel", [])]
        metric_match = any(metric_lower in m or m in metric_lower for m in item_metrics)
        channel_match = channel is None or channel.lower() in item_channels
        if metric_match and channel_match:
            return item
    return None


def _chunk_to_citation_id(chunk_id: str) -> str:
    """Deterministic citation id placeholder until plan citations are assembled."""
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"benchmark:{chunk_id}"))


def select_kpi_target_mode(
    *,
    metric: str,
    funnel_stage: str,
    brief: StrategyBrief,
    retrieval_pack: RetrievedKnowledgePack,
    channel: str | None = None,
    previous_plan: StrategyPlan | None = None,
) -> KpiTarget:
    """
    Priority: verified_benchmark_range → baseline_improvement → owner_target → establish_baseline.
    """
    benchmark_item = _verified_benchmark_item(
        retrieval_pack.items,
        metric=metric,
        channel=channel,
    )
    if benchmark_item is not None:
        excerpt = benchmark_item.excerpt
        return KpiTarget(
            metric=metric,
            funnel_stage=funnel_stage,
            target_mode=KpiTargetMode.verified_benchmark_range,
            target_value=excerpt[:120] if excerpt else "benchmark range",
            benchmark_citation_id=_chunk_to_citation_id(str(benchmark_item.chunk_id)),
            measurement_method=f"Track {metric} weekly",
            notes=SourcedClaim(
                text=f"Verified benchmark from retrieved knowledge: {benchmark_item.title}",
                source=ClaimSource.deterministic_result,
                citation_ids=[],
            ),
        )

    if previous_plan is not None:
        for prior in previous_plan.kpi_targets:
            if prior.metric.lower() == metric.lower():
                return KpiTarget(
                    metric=metric,
                    funnel_stage=funnel_stage,
                    target_mode=KpiTargetMode.baseline_improvement,
                    target_value=prior.target_value or "Improve from prior baseline",
                    measurement_method=prior.measurement_method,
                    notes=SourcedClaim(
                        text=f"Improvement target based on prior plan metric '{prior.metric}'.",
                        source=ClaimSource.deterministic_result,
                        citation_ids=[],
                    ),
                )

    owner_value = _owner_stated_target(brief, metric)
    if owner_value:
        return KpiTarget(
            metric=metric,
            funnel_stage=funnel_stage,
            target_mode=KpiTargetMode.owner_target,
            target_value=owner_value,
            measurement_method=f"Track {metric} against owner-stated target",
            notes=SourcedClaim(
                text="Owner stated an explicit numeric target in brief constraints or clarifications.",
                source=ClaimSource.owner_input,
                citation_ids=[],
            ),
        )

    return KpiTarget(
        metric=metric,
        funnel_stage=funnel_stage,
        target_mode=KpiTargetMode.establish_baseline,
        target_value=None,
        measurement_method=f"Establish and track baseline for {metric}",
        notes=SourcedClaim(
            text="No verified benchmark or owner target; establish baseline first.",
            source=ClaimSource.deterministic_result,
            citation_ids=[],
        ),
    )


def compute_kpi_targets(
    *,
    brief: StrategyBrief,
    retrieval_pack: RetrievedKnowledgePack,
    primary_channels: list[str],
    previous_plan: StrategyPlan | None = None,
) -> list[KpiTarget]:
    metrics = OBJECTIVE_KPI_METRICS.get(brief.primary_objective, ("reach",))
    query_context = retrieval_pack.query_context
    if hasattr(query_context, "funnel_stage"):
        funnel_stage = query_context.funnel_stage
    else:
        funnel_stage = query_context.get("funnel_stage", "awareness")
    if hasattr(funnel_stage, "value"):
        funnel_stage = funnel_stage.value  # type: ignore[union-attr]

    targets: list[KpiTarget] = []
    for index, metric in enumerate(metrics):
        channel = primary_channels[index] if index < len(primary_channels) else None
        targets.append(
            select_kpi_target_mode(
                metric=metric,
                funnel_stage=str(funnel_stage),
                brief=brief,
                retrieval_pack=retrieval_pack,
                channel=channel,
                previous_plan=previous_plan,
            )
        )
    return targets
