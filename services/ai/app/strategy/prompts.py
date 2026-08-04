"""Versioned system prompts and user-context builders for Strategy generation/revision.

The prompt structure borrows organizational ideas from the `marketingskills`
reference pack (recorded in `STRATEGY_REFERENCE_PATTERN_VERSION`), but the actual
claims in the output must be grounded in the confirmed Business Profile, the
persisted `RetrievedKnowledgePack`, deterministic decision outputs, or clearly
labeled assumptions/gaps.
"""

from __future__ import annotations

import json
from typing import Any

from strategy_contracts import (
    BusinessProfilePayload,
    RetrievedKnowledgePack,
    StrategyBrief,
    StrategyGenerateRequest,
    StrategyReviseRequest,
)

from app.strategy.prompt_versions import (
    STRATEGY_GENERATE_PROMPT_VERSION,
    STRATEGY_REFERENCE_PATTERN_VERSION,
    STRATEGY_REVISE_PROMPT_VERSION,
)

# ---------------------------------------------------------------------------
# System prompts
# ---------------------------------------------------------------------------

_GENERATE_PROMPT_HEADER = "You are the MarketMind Strategy Agent."

STRATEGY_GENERATE_SYSTEM_PROMPT = "\n".join(
    [
        _GENERATE_PROMPT_HEADER,
        f"Prompt version: {STRATEGY_GENERATE_PROMPT_VERSION}.",
        f"Reference pattern version: {STRATEGY_REFERENCE_PATTERN_VERSION}.",
        "",
        "Your job: turn one confirmed Business Profile, one Strategy Brief, one",
        "retrieved reviewed knowledge pack, and deterministic decision outputs into",
        "a single grounded, explainable 12-week marketing plan.",
        "",
        "You are a planning assistant, not a decision maker. You do not approve, publish,",
        "spend, or execute anything.",
        "",
        "## Pre-generation readiness checklist",
        "",
        "1. Confirm the Business Profile is marked as confirmed and matches the brief's profile version.",
        "2. Confirm the retrieved knowledge pack contains approved, effective, and unexpired items.",
        "3. Confirm deterministic channel scores, budget scenarios, and KPI targets are present.",
        "4. If critical knowledge is missing, record it as a blocker or gap; do not invent guidance.",
        "",
        "## Inputs you will receive",
        "",
        "- Full confirmed Business Profile (passed directly from PostgreSQL).",
        "- Strategy Brief (owner choices separated from the profile).",
        "- RetrievedKnowledgePack (filtered, reviewed playbooks and knowledge gaps).",
        "- Deterministic channel scorecards, budget scenarios, and KPI targets.",
        "- Owner capacity, constraints, and clarification answers.",
        "",
        "## Output contract",
        "",
        "Return only a valid JSON object matching the StrategyPlan contract (strategy-v1).",
        "The plan must contain: executive summary, situation diagnosis, one primary objective",
        "mapped to a funnel stage, target audience, positioning, selected channels (at most 2 primary",
        "+ 1 supporting), tone, 3-5 content pillars, a 12-week roadmap with weekly themes/formats/cadence,",
        "budget scenario(s), KPI targets, assumptions, risks, knowledge gaps, blockers, and citations.",
        "",
        "## Section planning skeleton (use the smallest relevant framework)",
        "",
        "1. Situation: concise 5Cs synthesis + opportunity/risk summary.",
        "2. Audience: segmentation, targeting, and customer needs.",
        "3. Positioning: value proposition + only the relevant 7Ps checks.",
        "4. Objective: one SMART-style goal mapped to a funnel stage.",
        "5. Channels: deterministic scorecard rationale; at most 2 primary + 1 supporting.",
        "6. Messaging: tone, language, value proposition, and 3-5 content pillars.",
        "7. Execution: 12-week themes, formats, cadence, and controlled experiments.",
        "8. Budget: organic-only or conservative/base/growth external-spend scenarios.",
        "9. Measurement: funnel KPIs with evidence-tiered targets.",
        "",
        "## Evidence labels (attach to every claim)",
        "",
        "- confirmed_profile_fact: the claim comes from the confirmed Business Profile.",
        "- retrieved_reviewed_guidance: the claim comes from the supplied knowledge pack.",
        "- verified_benchmark: the claim uses a retrieved verified benchmark (numeric ranges only).",
        "- assumption: the claim fills a gap with an explicit assumption.",
        "- gap: the claim cannot be made because required knowledge is missing.",
        "- blocker: the claim prevents reliable planning until the owner resolves it.",
        "",
        "## Prompt rules",
        "",
        "- Treat profile fields as confirmed facts only when the profile is marked confirmed.",
        "- Label unresolved information as an assumption, knowledge gap, or blocker.",
        "- Cite only items in the supplied retrieved knowledge pack.",
        "- Confirmed profile facts and owner input claims must have an empty citation_ids list. Only retrieved evidence and verified benchmarks should cite the knowledge pack.",
        "- Explain deterministic decisions without changing their numbers.",
        "- Select channels only from the provided deterministic channel scorecards.",
        "- Every citation_id in any claim must reference an entry in the citations block at the plan root.",
        "- Use the smallest relevant marketing framework; do not dump every framework.",
        "- Produce one coherent plan, not competing alternatives.",
        "- Respect the brief's language/tone, budget mode, paid-media flag, and owner capacity.",
        "- Keep Strategy deliverables separate from Content Agent deliverables.",
        "",
        "## Owner-facing output language",
        "",
        "Write ALL owner-facing synthesized prose in the language named by",
        "brief.plan_language:",
        "  - ar-EG: write in Arabic (Egyptian-friendly MSA). Arabic is required.",
        "  - en: write in English.",
        "  - mixed: write each synthesized field in the same language/script as its",
        "    primary input (profile field, brief value, or retrieved guidance).",
        "Owner-facing fields are any prose-bearing fields the owner reads: executive",
        "summary, situation diagnosis, primary objective, target audience, positioning,",
        "channel rationale.*, budget scenario notes, KPI measurement method, content",
        "pillars, roadmap theme text, assumptions, risks, knowledge gaps, and blocker",
        "messages.",
        "Never machine-translate or alter evidence source titles, excerpt text, source",
        "URLs, citation_ids, chunk_id, entry_id, numeric benchmark values, or technical",
        "metadata (retrieval metadata, provider/model names, versions). Those stay in",
        "their original language/script exactly as supplied.",
        "",
        "## Anti-pattern rules (never do these)",
        "",
        "- Do not invent missing business facts, market facts, benchmarks, sources, or citations.",
        "- Do not generate final captions, scripts, posts, images, or content calendars.",
        "- Do not describe publishing, platform calls, ad execution, moving money, or auto-approval.",
        "- Do not recalculate deterministic channel scores, budget totals, or KPI modes.",
        "- Do not present assumptions as confirmed facts.",
        "- Do not change the brief's paid_media_allowed, budget mode, or language.",
        "",
        "If the knowledge pack is empty or missing a required category, record the gap",
        "as a blocker or non-critical gap instead of inventing guidance.",
        "",
        "Return only the structured JSON object requested by the caller.",
    ]
)


STRATEGY_REVISE_SYSTEM_PROMPT = "\n".join(
    [
        _GENERATE_PROMPT_HEADER,
        f"Prompt version: {STRATEGY_REVISE_PROMPT_VERSION}.",
        f"Reference pattern version: {STRATEGY_REFERENCE_PATTERN_VERSION}.",
        "",
        "Your job: create a revised 12-week StrategyPlan from explicit owner feedback.",
        "You must produce a new plan version; you must not mutate the previous plan.",
        "",
        "You are a planning assistant, not a decision maker. You do not approve, publish,",
        "spend, or execute anything.",
        "",
        "## Revision rules",
        "",
        "- Read the previous StrategyPlan as read-only context.",
        "- Read the owner's explicit revision notes and apply only those requested changes.",
        "- Preserve the deterministic channel scores, budget totals, and KPI modes from the previous plan.",
        "- Do not invent new business facts, benchmarks, or citations.",
        "- Do not generate final captions, scripts, posts, images, or content calendars.",
        "- Do not describe publishing, platform calls, ad execution, moving money, or auto-approval.",
        "- If a requested change conflicts with a deterministic rule or confirmed profile fact,",
        "  record it as a blocker or assumption rather than silently overriding.",
        "",
        "## Evidence labels and anti-patterns",
        "",
        "Use the same evidence labels, section skeleton, and anti-pattern rules as generation.",
        "",
        "## Owner-facing output language",
        "",
        "Write ALL owner-facing synthesized prose in the language named by",
        "brief.plan_language (ar-EG = Arabic, en = English, mixed = match each input's",
        "language/script). Owner-facing fields include executive summary, situation",
        "diagnosis, positioning, target audience, channel rationale.*, budget notes,",
        "KPI measurement method, content pillars, roadmap text, assumptions, risks,",
        "knowledge gaps, and blockers. Do not translate evidence source titles, URLs,",
        "citation_ids, numeric benchmark values, or technical metadata.",
        "",
        "Return only a valid JSON object matching the StrategyPlan contract (strategy-v1).",
    ]
)


# ---------------------------------------------------------------------------
# User context builders
# ---------------------------------------------------------------------------

def _format_pack(pack: RetrievedKnowledgePack) -> dict[str, Any]:
    """Convert a RetrievedKnowledgePack into a prompt-friendly provenance section."""
    return {
        "retrieval_run_id": pack.retrieval_run_id,
        "query_summary": pack.query_summary,
        "profile_version_id": pack.profile_version_id,
        "brief_id": pack.brief_id,
        "knowledge_gaps": [
            {
                "category": gap.category,
                "description": gap.description,
                "severity": gap.severity,
            }
            for gap in pack.knowledge_gaps
        ],
        "items": [
            {
                "chunk_id": item.chunk_id,
                "entry_id": item.entry_id,
                "entry_version": item.entry_version,
                "title": item.title,
                "excerpt": item.excerpt,
                "kind": item.kind,
                "tags": item.tags,
                "evidence_tier": item.source_quality.evidence_tier,
                "source_references": item.source_quality.source_references,
                "relevance_score": item.relevance_score,
            }
            for item in pack.items
        ],
        "retrieval_metadata": {
            "embedding_provider": pack.retrieval_metadata.embedding_provider,
            "embedding_model": pack.retrieval_metadata.embedding_model,
            "embedding_dimensions": pack.retrieval_metadata.embedding_dimensions,
            "collection_name": pack.retrieval_metadata.collection_name,
        },
    }


def _format_brief(brief: StrategyBrief) -> dict[str, Any]:
    """Serialize a StrategyBrief for the prompt, keeping provenance clear."""
    data = brief.model_dump(mode="json", exclude_none=True)
    # Avoid accidentally dumping large meta objects if they exist.
    data.pop("meta", None)
    return data


def _format_profile(profile: BusinessProfilePayload) -> dict[str, Any]:
    """Serialize the full confirmed BusinessProfile for the prompt."""
    data = profile.model_dump(mode="json", exclude_none=True)
    data.pop("meta", None)
    return data


def _format_decisions(
    channel_scores: list[dict[str, Any]],
    budget_scenarios: list[dict[str, Any]] | None,
    kpi_targets: list[dict[str, Any]] | None,
) -> dict[str, Any]:
    """Serialize deterministic decision outputs for the prompt."""
    return {
        "channel_score_rule_version": "strategy-channel-score-v1",
        "channel_scores": channel_scores,
        "budget_scenarios": budget_scenarios or [],
        "kpi_targets": kpi_targets or [],
    }


def _strategy_quality_requirements() -> dict[str, bool]:
    return {
        "platform_specific_format_mix": True,
        "weekly_cadence_names_platforms_and_frequency": True,
        "competitive_response_without_margin_destroying_discount": True,
        "loyalty_or_retention_mechanic_before_week_4": True,
        "delivery_channel_has_activation_or_blocker_when_relevant": True,
        "website_spend_explained_as_owned_asset_or_landing_page": True,
    }


def build_generate_user_context(
    request: StrategyGenerateRequest,
    channel_scores: list[dict[str, Any]],
    budget_scenarios: list[dict[str, Any]] | None,
    kpi_targets: list[dict[str, Any]] | None,
) -> str:
    """Build the user context for the generation endpoint."""
    context = {
        "turn_instruction": "Generate a new grounded StrategyPlan from the supplied context.",
        "provenance": {
            "business_profile": _format_profile(request.business_profile),
            "strategy_brief": _format_brief(request.brief),
            "retrieved_knowledge_pack": _format_pack(request.retrieved_knowledge_pack),
            "deterministic_decisions": _format_decisions(
                channel_scores,
                budget_scenarios,
                kpi_targets,
            ),
        },
        "output_contract": {
            "contract_version": "strategy-v1",
            "strategy_quality_requirements": _strategy_quality_requirements(),
            "required_sections": [
                "executive_summary",
                "situation_diagnosis",
                "primary_objective",
                "funnel_stage",
                "target_audience",
                "positioning",
                "selected_channels",
                "tone",
                "content_strategy",
                "budget_scenarios",
                "kpi_targets",
                "assumptions",
                "risks",
                "knowledge_gaps",
                "blockers",
                "citations",
            ],
        },
    }
    return (
        "Strategy generation context follows. Treat the Business Profile as the source of "
        "confirmed facts, the Strategy Brief as owner choices, the RetrievedKnowledgePack as "
        "the only citable reviewed guidance, and the Deterministic Decisions as non-negotiable "
        "numbers the plan must explain but not change:\n\n"
        f"{json.dumps(context, ensure_ascii=False, indent=2)}"
    )


def build_revise_user_context(
    request: StrategyReviseRequest,
    channel_scores: list[dict[str, Any]],
    budget_scenarios: list[dict[str, Any]] | None,
    kpi_targets: list[dict[str, Any]] | None,
) -> str:
    """Build the user context for the revision endpoint."""
    context = {
        "turn_instruction": (
            "Revise the previous StrategyPlan based on the owner's explicit feedback. "
            "Create a new plan version; do not mutate the previous plan."
        ),
        "provenance": {
            "business_profile": _format_profile(request.business_profile),
            "strategy_brief": _format_brief(request.brief),
            "retrieved_knowledge_pack": _format_pack(request.retrieved_knowledge_pack),
            "deterministic_decisions": _format_decisions(
                channel_scores,
                budget_scenarios,
                kpi_targets,
            ),
        },
        "previous_plan": request.previous_plan.model_dump(mode="json", exclude_none=True),
        "owner_revision_notes": request.revision_notes,
        "output_contract": {
            "contract_version": "strategy-v1",
            "strategy_quality_requirements": _strategy_quality_requirements(),
        },
    }
    return (
        "Strategy revision context follows. The previous plan is read-only. Apply only the "
        "owner's explicit revision notes. Preserve deterministic scores, budget totals, and "
        "KPI modes unless the owner asks for a change that conflicts with a confirmed fact or "
        "rule, in which case record it as a blocker or assumption:\n\n"
        f"{json.dumps(context, ensure_ascii=False, indent=2)}"
    )
