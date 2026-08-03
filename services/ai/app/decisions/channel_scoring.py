"""Eight deterministic channel scoring dimensions."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Final

from strategy_contracts import (
    ChannelDimensionScores,
    ChannelRole,
    ExternalBudgetMode,
    StrategyBrief,
    calculate_channel_total,
)

from app.decisions.config import (
    AUDIENCE_FIT_NEUTRAL,
    CAPACITY_STEPDOWN_SCORES,
    CAPACITY_TIER_ORDER,
    CHANNEL_ALIASES,
    CHANNEL_EFFORT_TIER,
    CHANNEL_MIN_VIABLE_SPEND_EGP,
    CHANNEL_REQUIRED_ASSET_KEYWORDS,
    EVIDENCE_TIER_WEIGHTS,
    EXISTING_PRESENCE_COLD_START,
    MEASUREMENT_CAPACITY_BOOST,
    MEASUREMENT_READINESS_BASELINE,
    OBJECTIVE_ADJACENT_FUNNEL_STAGES,
    STANDARD_CHANNELS,
)
from app.decisions.normalize import NormalizedInputs
from app.rag.schemas import HydratedItem, KnowledgeGap, RetrievedKnowledgePack


@dataclass
class DimensionResult:
    value: float
    factors: list[str] = field(default_factory=list)


@dataclass
class ScoringContext:
    knowledge_gaps: list[KnowledgeGap] = field(default_factory=list)


ASSET_REQUIREMENT_GROUPS: Final[dict[str, tuple[tuple[str, ...], ...]]] = {
    "delivery_platforms": (("menu", "catalog"), ("photo", "image")),
}
SOCIAL_CONVERSION_CHANNELS: Final[tuple[str, ...]] = (
    "facebook",
    "instagram",
    "tiktok",
)
RESTAURANT_KEYWORDS: Final[tuple[str, ...]] = (
    "restaurant",
    "qsr",
    "food",
    "chicken",
    "fried",
    "مطعم",
    "فرايد",
    "دجاج",
)


def _channel_items(items: list[HydratedItem], channel: str) -> list[HydratedItem]:
    return [
        item
        for item in items
        if channel in item.tags.get("channel", [])
        or channel.replace("_", " ") in " ".join(item.tags.get("channel", [])).lower()
    ]


def _playbook_items(items: list[HydratedItem], channel: str) -> list[HydratedItem]:
    channel_items = _channel_items(items, channel)
    playbooks = [item for item in channel_items if item.kind == "channel_playbook"]
    return playbooks if playbooks else channel_items


def _profile_marketing(profile: dict[str, Any]) -> dict[str, Any]:
    return profile.get("confirmed_facts", {}).get("current_marketing", {})


def _profile_business_type(profile: dict[str, Any]) -> str:
    identity = profile.get("confirmed_facts", {}).get("identity", {})
    return str(identity.get("business_type", "")).lower()


def _has_existing_presence(profile: dict[str, Any], channel: str) -> bool:
    marketing = _profile_marketing(profile)
    activities = marketing.get("current_activities", []) + marketing.get(
        "active_channels", []
    )
    return any(_activity_matches_channel(str(activity), channel) for activity in activities)


def _conversion_fallback(
    channel: str,
    profile: dict[str, Any],
    brief: StrategyBrief,
) -> DimensionResult | None:
    if brief.primary_objective.value != "conversion":
        return None
    if channel in SOCIAL_CONVERSION_CHANNELS and _has_existing_presence(profile, channel):
        return DimensionResult(
            0.75,
            ["Warm social audience can support conversion through DMs and retargeting"],
        )
    business_type = _profile_business_type(profile)
    if channel == "delivery_platforms" and any(
        keyword in business_type for keyword in RESTAURANT_KEYWORDS
    ):
        return DimensionResult(
            0.75,
            ["Restaurant delivery platforms can support order conversion"],
        )
    return None


def score_objective_fit(
    channel: str,
    profile: dict[str, Any],
    brief: StrategyBrief,
    retrieval_pack: RetrievedKnowledgePack,
    normalized: NormalizedInputs,
    ctx: ScoringContext,
) -> DimensionResult:
    del normalized
    items = _playbook_items(retrieval_pack.items, channel)
    objective = brief.primary_objective.value
    fallback = _conversion_fallback(channel, profile, brief)
    if not items:
        if fallback is not None:
            return fallback
        ctx.knowledge_gaps.append(
            KnowledgeGap(
                category=f"channel_playbook:{channel}",
                description=f"No channel playbook retrieved for {channel}.",
                severity="non_critical",
            )
        )
        return DimensionResult(0.0, ["No channel playbook retrieved"])

    for item in items:
        objectives = item.tags.get("objectives", [])
        if objective in objectives:
            return DimensionResult(1.0, [f"Playbook tags include objective '{objective}'"])

    adjacent = OBJECTIVE_ADJACENT_FUNNEL_STAGES.get(objective, ())
    for item in items:
        funnel = item.tags.get("funnel_stages", [])
        if any(stage in funnel for stage in adjacent):
            return DimensionResult(
                0.5,
                [f"Adjacent funnel stage overlap for objective '{objective}'"],
            )

    if fallback is not None:
        return fallback

    return DimensionResult(0.0, ["No objective or adjacent funnel match in playbook tags"])


def score_audience_fit(
    channel: str,
    profile: dict[str, Any],
    brief: StrategyBrief,
    retrieval_pack: RetrievedKnowledgePack,
    normalized: NormalizedInputs,
    ctx: ScoringContext,
) -> DimensionResult:
    del brief, normalized, ctx
    items = _channel_items(retrieval_pack.items, channel)
    if not items:
        return DimensionResult(AUDIENCE_FIT_NEUTRAL, ["No channel item; neutral audience score"])

    customers = profile.get("confirmed_facts", {}).get("customers", {})
    profile_signals: set[str] = set()
    for key in ("primary_segments", "visit_or_order_occasions", "customer_needs"):
        for value in customers.get(key, []):
            profile_signals.add(str(value).lower())

    best_ratio = 0.0
    best_factors: list[str] = []
    for item in items:
        channel_tags: set[str] = set()
        for tag_key in ("industries", "industry", "business_models", "business_model"):
            channel_tags.update(tag.lower() for tag in item.tags.get(tag_key, []))
        if not channel_tags:
            continue
        overlap = profile_signals & channel_tags
        ratio = min(1.0, len(overlap) / len(channel_tags))
        if ratio > best_ratio:
            best_ratio = ratio
            best_factors = [
                f"Overlap {len(overlap)}/{len(channel_tags)} tags: {sorted(overlap)}"
            ]

    if not best_factors:
        return DimensionResult(AUDIENCE_FIT_NEUTRAL, ["No comparable audience tags on channel item"])

    return DimensionResult(best_ratio, best_factors)


def _activity_matches_channel(activity: str, channel: str) -> bool:
    lowered = activity.lower()
    aliases = CHANNEL_ALIASES.get(channel, (channel,))
    return any(alias in lowered for alias in aliases)


def score_existing_presence(
    channel: str,
    profile: dict[str, Any],
    brief: StrategyBrief,
    retrieval_pack: RetrievedKnowledgePack,
    normalized: NormalizedInputs,
    ctx: ScoringContext,
) -> DimensionResult:
    del brief, retrieval_pack, normalized, ctx
    marketing = _profile_marketing(profile)
    activities = marketing.get("current_activities", []) + marketing.get(
        "active_channels", []
    )
    for activity in activities:
        if _activity_matches_channel(str(activity), channel):
            return DimensionResult(1.0, [f"Existing presence: {activity}"])

    return DimensionResult(
        EXISTING_PRESENCE_COLD_START,
        ["No existing presence; cold-start baseline"],
    )


def score_asset_format_fit(
    channel: str,
    profile: dict[str, Any],
    brief: StrategyBrief,
    retrieval_pack: RetrievedKnowledgePack,
    normalized: NormalizedInputs,
    ctx: ScoringContext,
) -> DimensionResult:
    del brief, retrieval_pack, normalized, ctx
    required = CHANNEL_REQUIRED_ASSET_KEYWORDS.get(channel, ())
    if not required:
        return DimensionResult(1.0, ["No required assets for this channel"])

    assets = _profile_marketing(profile).get("available_assets", [])
    asset_text = " ".join(str(a).lower() for a in assets)
    requirement_groups = ASSET_REQUIREMENT_GROUPS.get(channel, (required,))
    matched_groups = [
        [keyword for keyword in group if keyword in asset_text]
        for group in requirement_groups
    ]
    fulfilled_groups = [group for group in matched_groups if group]
    score = len(fulfilled_groups) / len(requirement_groups)
    return DimensionResult(
        score,
        [
            (
                "Matched "
                f"{len(fulfilled_groups)}/{len(requirement_groups)} "
                "asset requirement groups"
            ),
            f"Matched asset keywords by group: {fulfilled_groups}",
        ],
    )


def score_team_capacity(
    channel: str,
    profile: dict[str, Any],
    brief: StrategyBrief,
    retrieval_pack: RetrievedKnowledgePack,
    normalized: NormalizedInputs,
    ctx: ScoringContext,
) -> DimensionResult:
    del profile, brief, retrieval_pack, ctx
    effort = CHANNEL_EFFORT_TIER.get(channel, "medium")
    capacity_index = CAPACITY_TIER_ORDER.index(normalized.capacity_tier.value)
    effort_index = {"low": 0, "medium": 1, "high": 2}[effort]
    gap = max(0, effort_index - capacity_index)
    value = CAPACITY_STEPDOWN_SCORES.get(gap, 0.0)
    return DimensionResult(
        value,
        [
            f"Capacity tier: {normalized.capacity_tier.value}",
            f"Channel effort tier: {effort}",
            f"Gap steps: {gap}",
        ],
    )


def score_budget_fit(
    channel: str,
    profile: dict[str, Any],
    brief: StrategyBrief,
    retrieval_pack: RetrievedKnowledgePack,
    normalized: NormalizedInputs,
    ctx: ScoringContext,
) -> DimensionResult:
    del profile, retrieval_pack, ctx
    if brief.external_budget_mode == ExternalBudgetMode.organic_only:
        return DimensionResult(1.0, ["Organic-only mode; budget fit not applicable"])

    anchor = normalized.budget_anchor_egp
    minimum = CHANNEL_MIN_VIABLE_SPEND_EGP.get(channel, 0)
    if anchor is None or anchor <= 0:
        return DimensionResult(0.0, ["No budget anchor available"])

    if anchor >= minimum:
        return DimensionResult(
            1.0,
            [f"Budget {anchor:.0f} EGP meets minimum {minimum} EGP"],
        )

    if minimum == 0:
        return DimensionResult(1.0, ["Channel has no minimum spend requirement"])

    ratio = anchor / minimum
    return DimensionResult(
        max(0.0, min(1.0, ratio)),
        [f"Budget {anchor:.0f} EGP below minimum {minimum} EGP"],
    )


def score_evidence_strength(
    channel: str,
    profile: dict[str, Any],
    brief: StrategyBrief,
    retrieval_pack: RetrievedKnowledgePack,
    normalized: NormalizedInputs,
    ctx: ScoringContext,
) -> DimensionResult:
    del profile, brief, normalized
    items = _channel_items(retrieval_pack.items, channel)
    if not items:
        ctx.knowledge_gaps.append(
            KnowledgeGap(
                category=f"evidence:{channel}",
                description=f"No retrieved evidence for {channel}.",
                severity="non_critical",
            )
        )
        return DimensionResult(0.0, ["No retrieved evidence for channel"])

    weighted_sum = 0.0
    weight_total = 0.0
    tiers_used: list[str] = []
    for item in items:
        tier_weight = EVIDENCE_TIER_WEIGHTS.get(item.evidence_tier, 0.0)
        weighted_sum += tier_weight * item.relevance_score
        weight_total += item.relevance_score
        tiers_used.append(item.evidence_tier)

    value = weighted_sum / weight_total if weight_total else 0.0
    return DimensionResult(
        round(value, 2),
        [f"Weighted evidence from tiers: {tiers_used}"],
    )


def score_measurement_readiness(
    channel: str,
    profile: dict[str, Any],
    brief: StrategyBrief,
    retrieval_pack: RetrievedKnowledgePack,
    normalized: NormalizedInputs,
    ctx: ScoringContext,
) -> DimensionResult:
    del profile, brief, retrieval_pack, ctx
    baseline = MEASUREMENT_READINESS_BASELINE.get(channel, 0.4)
    boost = MEASUREMENT_CAPACITY_BOOST.get(normalized.capacity_tier.value, 0.0)
    if channel in ("instagram", "facebook", "tiktok"):
        value = min(1.0, baseline + boost)
        return DimensionResult(
            round(value, 2),
            [f"Organic social baseline {baseline} + capacity boost {boost}"],
        )
    return DimensionResult(baseline, [f"Fixed measurement baseline {baseline}"])


DIMENSION_SCORERS = (
    ("objective_fit", score_objective_fit),
    ("audience_fit", score_audience_fit),
    ("existing_presence", score_existing_presence),
    ("asset_format_fit", score_asset_format_fit),
    ("team_capacity", score_team_capacity),
    ("budget_fit", score_budget_fit),
    ("evidence_strength", score_evidence_strength),
    ("measurement_readiness", score_measurement_readiness),
)


def score_channel(
    channel: str,
    profile: dict[str, Any],
    brief: StrategyBrief,
    retrieval_pack: RetrievedKnowledgePack,
    normalized: NormalizedInputs,
    ctx: ScoringContext,
) -> tuple[ChannelDimensionScores, list[DimensionResult], float]:
    results: dict[str, DimensionResult] = {}
    for name, scorer in DIMENSION_SCORERS:
        results[name] = scorer(channel, profile, brief, retrieval_pack, normalized, ctx)

    scores = ChannelDimensionScores(**{name: round(r.value, 2) for name, r in results.items()})
    from strategy_contracts import DeterministicChannelScorecard

    total = calculate_channel_total(
        DeterministicChannelScorecard(
            channel=channel,
            role=ChannelRole.supporting,
            scores=scores,
            total_score=0,
        )
    )
    return scores, list(results.values()), total


def score_all_channels(
    profile: dict[str, Any],
    brief: StrategyBrief,
    retrieval_pack: RetrievedKnowledgePack,
    normalized: NormalizedInputs,
    channels: tuple[str, ...] = STANDARD_CHANNELS,
) -> tuple[list[tuple[str, ChannelDimensionScores, list[DimensionResult], float]], list[KnowledgeGap]]:
    ctx = ScoringContext()
    scored: list[tuple[str, ChannelDimensionScores, list[DimensionResult], float]] = []
    for channel in channels:
        scores, dim_results, total = score_channel(
            channel, profile, brief, retrieval_pack, normalized, ctx
        )
        scored.append((channel, scores, dim_results, total))
    return scored, ctx.knowledge_gaps
