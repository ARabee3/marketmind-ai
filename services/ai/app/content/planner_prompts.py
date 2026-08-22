"""Planner-stage prompts for Content v2 (issue #187).

The planner creates 3-5 high-level post cards for an actionable week; it
never produces publishable copy, approvals, or publishing decisions. The
full-draft worker consumes a frozen plan/profile/CTA/media snapshot later.
"""

from __future__ import annotations

import json
from typing import Any

from content_v2_contracts import AiContentV2PlanRequest

from app.content.prompt_versions import (
    CONTENT_PLAN_PROMPT_VERSION,
    CONTENT_REFERENCE_PATTERN_VERSION,
)

CONTENT_PLAN_SYSTEM_PROMPT = "\n".join(
    [
        "You are the MarketMind Content Planner.",
        f"Prompt version: {CONTENT_PLAN_PROMPT_VERSION}.",
        f"Reference pattern version: {CONTENT_REFERENCE_PATTERN_VERSION}.",
        "",
        "Your job: plan the exact requested Strategy week as 3-5 high-level post cards.",
        "You are the first stage only. You never write final copy, captions, or scripts.",
        "NestJS owns lifecycle, approval, scheduling, and publishing.",
        "You must not choose another week, approve, schedule, publish, or invent facts.",
        "",
        "## Card rules",
        "",
        "- Produce exactly 3-5 cards, each with a distinct purpose.",
        "- Use only the supplied allowed_channels and allowed_formats.",
        "- Each card picks zero or one primary CTA by id from the supplied CTA library.",
        "- Each card may reference supplied media ids; never invent an asset.",
        "- Keep purpose, intended_audience, owner_instructions, and visual_direction concise and grounded in the supplied Strategy week and editorial profile.",
        "- owner_instructions must only repeat or sharpen the owner's supplied writing guardrails; never add new requirements.",
        "- visual_direction must respect the editorial profile's default_visual_guidance when present.",
        "",
        "## Grounding rules",
        "",
        "- Use only the supplied Strategy week, editorial profile, CTA library, and media library.",
        "- The Strategy week's formats are authoritative; do not substitute formats.",
        "- Never invent offers, prices, facts, or media assets.",
        (
            "- Always return 3-5 cards. Reuse allowed channel and format "
            "combinations with distinct grounded purposes when needed; omit "
            "optional CTA or media references instead of reducing the card "
            "count or inventing inputs."
        ),
        "",
        "## Forbidden output",
        "",
        "- No captions, hashtag lists, scripts, or publishable copy.",
        "- No approval or publishing decisions.",
        "- No channels or formats outside the supplied allowlists.",
    ]
)


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True)


def build_plan_context(request: AiContentV2PlanRequest) -> dict[str, Any]:
    """Return the typed planner context; providers read this directly."""
    week = next(
        week
        for week in request.strategy_plan.calendar_weeks
        if week.week_number == request.week_number
    )
    week_handoff = next(
        entry
        for entry in request.strategy_plan.content_handoff.weeks
        if entry.week_number == request.week_number
    )
    advice_items = [
        item
        for advice in request.strategy_plan.owner_advice.weeks
        if advice.week_number == request.week_number
        for item in advice.items
    ]
    profile = request.editorial_profile.model_dump(mode="json", exclude_none=True)
    return {
        "plan_identity": {
            "week_plan_id": request.week_plan_id,
            "business_id": request.business_id,
            "strategy_id": request.strategy_id,
            "strategy_version": request.strategy_version,
            "strategy_decision_id": request.strategy_decision_id,
            "week_number": request.week_number,
            "language_mode": str(
                getattr(request.language_mode, "value", request.language_mode)
            ),
        },
        "grounding_inputs": {
            "strategy_week": {
                "focus": week.focus,
                "expected_outcome": week.expected_outcome,
                "measurement_check": week.measurement_check,
                "formats": list(week_handoff.formats),
                "owner_advice": [
                    item.action for item in advice_items[:8]
                ],
                "goal": request.strategy_plan.goal.text,
            },
            "editorial_profile": {
                "audience_nuance": profile.get("audience_nuance"),
                "voice": profile.get("voice"),
                "writing_guardrails": profile.get("writing_guardrails", []),
                "default_visual_guidance": profile.get(
                    "default_visual_guidance"
                ),
            },
            "cta_library": [
                {
                    "id": entry.id,
                    "label": entry.label,
                    "destination": entry.destination.model_dump(
                        mode="json", exclude_none=True
                    ),
                }
                for entry in request.cta_library
                if entry.active
            ],
            "media_library": [
                {
                    "id": entry.id,
                    "kind": entry.kind,
                    "mime_type": entry.mime_type,
                    "width": entry.width,
                    "height": entry.height,
                }
                for entry in request.media_library
                if entry.status == "ready"
            ],
            "allowed_channels": list(request.allowed_channels),
            "allowed_formats": list(request.allowed_formats),
        },
    }


def build_plan_user_context(request: AiContentV2PlanRequest) -> str:
    """Render the planner context as the user prompt for text-only providers."""
    context = build_plan_context(request)
    return "Plan the week as structured post cards.\n\n" + _json(context)
