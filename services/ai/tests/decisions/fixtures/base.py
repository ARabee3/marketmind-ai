"""Reusable fixture builders for deterministic decision-rule tests."""

from __future__ import annotations

import hashlib
import json
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from strategy_contracts import (
    BusinessProfilePayload,
    ExternalBudgetMode,
    StrategyBrief,
    StrategyObjective,
)

from app.rag.schemas import HydratedItem, KnowledgeGap, RetrievedKnowledgePack

EXAMPLES_DIR = Path(__file__).parent.parent.parent.parent.parent.parent / "packages" / "contracts" / "examples"


def load_json(filename: str) -> dict[str, Any]:
    return json.loads((EXAMPLES_DIR / filename).read_text(encoding="utf-8"))


def default_business_profile() -> BusinessProfilePayload:
    journey = load_json("cafe-full-journey.example.json")
    return BusinessProfilePayload.model_validate(journey["confirmed_business_profile"])


def default_brief(
    *,
    paid_media_allowed: bool = True,
    budget_mode: ExternalBudgetMode = ExternalBudgetMode.monthly_amount,
    budget_egp: float | dict[str, float] | None = 3000.0,
    team_capacity: str = "مالك يدير المحل ويساعده فرد واحد في المطبخ. لا يوجد متخصص تسويق.",
) -> StrategyBrief:
    data = load_json("strategy-brief.example.json")
    data["paid_media_allowed"] = paid_media_allowed
    data["external_budget_mode"] = budget_mode.value
    data["external_budget_egp"] = budget_egp
    data["team_capacity"] = team_capacity
    return StrategyBrief.model_validate(data)


def default_retrieval_pack() -> RetrievedKnowledgePack:
    """Build a RAG-shaped retrieval pack from the contract fixture."""
    contract_data = load_json("strategy-retrieval-pack.example.json")
    items = []
    for item_data in contract_data["items"]:
        sq = item_data.pop("source_quality", {})
        item_data["evidence_tier"] = sq.get("evidence_tier", "reviewed_guidance")
        item_data["source_references"] = sq.get("source_references", [])
        item_data["effective_at"] = sq.get("effective_at")
        item_data["expires_at"] = sq.get("expires_at")
        item_data["review_status"] = sq.get("review_status", "approved")
        item_data["market_tier"] = "egypt"
        item_data["is_fallback"] = False
        item_data["fallback_label"] = None
        item_data["category"] = item_data.get("kind", "guidance_article")
        items.append(HydratedItem.model_validate(item_data))
    contract_data["items"] = items
    return RetrievedKnowledgePack.model_validate(contract_data)


def retrieval_pack_with_channel_item(
    pack: RetrievedKnowledgePack,
    *,
    channel: str,
    kind: str = "channel_playbook",
    objectives: list[str] | None = None,
    funnel_stages: list[str] | None = None,
    industries: list[str] | None = None,
    business_models: list[str] | None = None,
    metric: list[str] | None = None,
    evidence_tier: str = "reviewed_guidance",
    relevance_score: float = 0.8,
) -> RetrievedKnowledgePack:
    """Return a copy of the pack with an extra item tagged for the given channel."""
    new_item = hydrated_item(
        channel=channel,
        kind=kind,
        objectives=objectives,
        funnel_stages=funnel_stages,
        industries=industries,
        business_models=business_models,
        metric=metric,
        evidence_tier=evidence_tier,
        relevance_score=relevance_score,
    )
    new_items = list(pack.items) + [new_item]
    data = pack.model_dump(mode="json")
    data["items"] = [item.model_dump(mode="json") for item in new_items]
    return RetrievedKnowledgePack.model_validate(data)


def profile_with_marketing(profile: BusinessProfilePayload, **kwargs: Any) -> BusinessProfilePayload:
    """Return a copy of the profile with current_marketing overrides."""
    profile_data = profile.model_dump(mode="json")
    current = profile_data["profile"]["confirmed_facts"].get("current_marketing", {})
    current.update(kwargs)
    profile_data["profile"]["confirmed_facts"]["current_marketing"] = current
    return BusinessProfilePayload.model_validate(profile_data)


def profile_with_customers(profile: BusinessProfilePayload, **kwargs: Any) -> BusinessProfilePayload:
    """Return a copy of the profile with customers overrides."""
    profile_data = profile.model_dump(mode="json")
    customers = profile_data["profile"]["confirmed_facts"].get("customers", {})
    customers.update(kwargs)
    profile_data["profile"]["confirmed_facts"]["customers"] = customers
    return BusinessProfilePayload.model_validate(profile_data)


def profile_with_capacity(profile: BusinessProfilePayload, team_capacity: str | None) -> BusinessProfilePayload:
    """Return a copy of the profile with goals_and_constraints.team_capacity set."""
    profile_data = profile.model_dump(mode="json")
    goals = profile_data["profile"]["confirmed_facts"].get("goals_and_constraints", {})
    goals["team_capacity"] = team_capacity
    profile_data["profile"]["confirmed_facts"]["goals_and_constraints"] = goals
    return BusinessProfilePayload.model_validate(profile_data)


def pack_without_items(pack: RetrievedKnowledgePack) -> RetrievedKnowledgePack:
    data = pack.model_dump(mode="json")
    data["items"] = []
    return RetrievedKnowledgePack.model_validate(data)


def build_minimal_pack(
    items: list[HydratedItem],
    gaps: list[KnowledgeGap] | None = None,
) -> RetrievedKnowledgePack:
    base = default_retrieval_pack().model_dump(mode="json")
    base["items"] = [item.model_dump(mode="json") for item in items]
    base["knowledge_gaps"] = (
        [gap.model_dump(mode="json") for gap in gaps] if gaps else []
    )
    return RetrievedKnowledgePack.model_validate(base)


def _uuid_suffix(text: str) -> str:
    """Return a 12-char hex suffix derived from text for deterministic UUIDs."""
    return hashlib.sha256(text.encode()).hexdigest()[:12]


def hydrated_item(
    *,
    channel: str,
    kind: str = "channel_playbook",
    objectives: list[str] | None = None,
    funnel_stages: list[str] | None = None,
    industries: list[str] | None = None,
    business_models: list[str] | None = None,
    metric: list[str] | None = None,
    evidence_tier: str = "reviewed_guidance",
    relevance_score: float = 0.8,
) -> HydratedItem:
    """Build a minimal hydrated item for a channel."""
    tags: dict[str, list[str]] = {"channel": [channel]}
    if objectives:
        tags["objectives"] = objectives
    if funnel_stages:
        tags["funnel_stages"] = funnel_stages
    if industries:
        tags["industry"] = industries
    if business_models:
        tags["business_model"] = business_models
    if metric:
        tags["metric"] = metric
    suffix = _uuid_suffix(f"{channel}:{kind}")
    return HydratedItem(
        chunk_id=f"cccccccc-9999-4000-8000-{suffix}",
        entry_id=f"eeeeeeee-9999-4000-8000-{suffix}",
        entry_version=1,
        title=f"{kind} for {channel}",
        excerpt=f"Synthetic fixture item for {channel}.",
        kind=kind,
        tags=tags,
        relevance_score=relevance_score,
        evidence_tier=evidence_tier,
        source_references=["fixture://synthetic"],
        effective_at=datetime.now(timezone.utc),
        expires_at=None,
        review_status="approved",
        market_tier="egypt",
        is_fallback=False,
        fallback_label=None,
        category=kind,
    )
