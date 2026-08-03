"""Refined prompt assembly for the Phase 6 real-provider spot-check.

The spot-check compares the deterministic fake-provider baseline against a real
provider.  The fake provider parses the JSON grounding context and always emits
contract-valid items.  Real providers need extra guardrails in the system
prompt so their structured output also satisfies the post-generation contract
validator.  This module builds a spot-check-specific prompt that leaves the
production generation prompt untouched.
"""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from content_contracts import AiContentGenerateRequest

from app.content.assembler import PromptAssembly, assemble_generation_prompt
from app.content.validators import derive_strategy_pillar_ids, derive_target_item_count


def build_spot_check_generation_prompt(
    request: AiContentGenerateRequest,
    provider_name: str,
    model: str,
) -> PromptAssembly:
    """Return a generation prompt with explicit Phase 6 validation constraints.

    The fake-provider baseline keeps using the standard prompt from
    ``assemble_generation_prompt``.  The real provider receives the same user
    context plus a system-prompt supplement that enumerates the exact rules the
    deterministic validator enforces, so it is far less likely to drift into
    contract-invalid values.
    """
    base = assemble_generation_prompt(request, provider_name, model)

    target_count = derive_target_item_count(
        request.strategy_plan.content_strategy.weekly_cadence
    )
    if target_count is None or not 3 <= target_count <= 5:
        target_count = 3

    expected_pillars = derive_strategy_pillar_ids(
        request.strategy_id,
        len(request.strategy_plan.content_strategy.pillars),
    )

    expected_locale = "en" if request.language_mode == "en" else "ar"
    week_start = request.week_context.week_start_date
    week_end = week_start + timedelta(days=7)

    destination = request.week_context.cta_destination
    destination_type: Any = None
    destination_value: Any = None
    if destination is not None:
        destination_type = getattr(destination, "type", None)
        destination_value = getattr(destination, "value", None)

    if destination_type == "none":
        cta_rule = (
            "The weekly context has no CTA destination (type=none). "
            "Do not emit any CTA destination text."
        )
    elif destination_value:
        cta_rule = (
            "If the weekly context has a CTA destination, "
            f"the generated CTA copy must include the confirmed destination value: {destination_value!r}."
        )
    else:
        cta_rule = (
            "The weekly context has no confirmed CTA destination value; "
            "do not emit a CTA destination."
        )

    language_mode_value = (
        request.language_mode.value
        if hasattr(request.language_mode, "value")
        else request.language_mode
    )
    objective_value = (
        request.strategy_plan.primary_objective.value
        if hasattr(request.strategy_plan.primary_objective, "value")
        else request.strategy_plan.primary_objective
    )

    supplement = "\n".join(
        [
            "## Phase 6 spot-check constraints",
            "",
            "This run is evaluated by a deterministic contract validator. "
            "Every item in `item_versions` must satisfy the rules below exactly:",
            "",
            f"1. Generate exactly {target_count} item(s).",
            f"2. Every item must use one of these channels: {request.selected_channels!r}.",
            f"3. Every item must use one of these formats: {request.allowed_formats!r}.",
            "4. `asset_required` must be `false` for `text_post`; "
            "it must be `true` for `static_image_post` and `carousel_brief`.",
            "5. `content_item_id` and `id` must be different valid UUIDs. "
            "Never reuse IDs across items.",
            f"6. `content_pack_id` must equal {request.content_pack_id!r}.",
            f"7. `strategy_trace.strategy_id` = {request.strategy_id!r}; "
            f"`strategy_trace.strategy_version` = {request.strategy_version!r}; "
            f"`strategy_trace.week_number` = {request.week_context.week_number}.",
            "8. `strategy_trace.channel` must match the item's `channel`.",
            f"9. `strategy_trace.pillar_ids` must be chosen only from {expected_pillars!r}.",
            f"10. `strategy_trace.objective` must equal {objective_value!r}.",
            f"11. `language_mode` must equal {language_mode_value!r}; "
            f"`caption_variants` must include locale {expected_locale!r}.",
            f"12. {cta_rule}",
            f"13. `recommended_publish_window.starts_at` and `ends_at` must be "
            f"timezone-aware ISO-8601 datetimes between {week_start.isoformat()} "
            f"and {week_end.isoformat()}, with `ends_at` > `starts_at`.",
            "14. Every item must include at least one `claim_sources` entry.",
            "15. `item.hashtags` must match the primary caption variant's `hashtags`.",
            "16. `item.cta` must match the primary caption variant's `cta`.",
            "",
            "Return only the structured JSON object requested by the caller.",
        ]
    )

    refined_system_prompt = "\n\n".join(
        [base.system_prompt, supplement, _spot_check_one_shot_example()]
    )

    return PromptAssembly(
        system_prompt=refined_system_prompt,
        user_prompt=base.user_prompt,
        metadata=base.metadata,
    )


def _spot_check_one_shot_example() -> str:
    """Return a concise structural example of a valid spot-check item."""
    return (
        "## Example of a valid spot-check item (use the real request values above, "
        "not these placeholder UUIDs):\n"
        "\n"
        "```json\n"
        "{\n"
        '  "item_versions": [\n'
        "    {\n"
        '      "id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",\n'
        '      "contract_version": "content-v1",\n'
        '      "content_item_id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",\n'
        '      "content_pack_id": "<use request.content_pack_id>",\n'
        '      "version": 1,\n'
        '      "channel": "<use one of request.selected_channels>",\n'
        '      "format": "<use one of request.allowed_formats>",\n'
        '      "language_mode": "<use request.language_mode>",\n'
        '      "strategy_trace": {\n'
        '        "strategy_id": "<use request.strategy_id>",\n'
        '        "strategy_version": "<use request.strategy_version>",\n'
        '        "week_number": <use request.week_context.week_number>,\n'
        '        "pillar_ids": ["<use one derived pillar id>"],\n'
        '        "objective": "<use request.strategy_plan.primary_objective>",\n'
        '        "channel": "<same as item.channel>"\n'
        "      },\n"
        '      "caption_variants": [\n'
        "        {\n"
        '          "locale": "<ar or en>",\n'
        '          "caption": "Owner-facing caption text.",\n'
        '          "cta": "CTA text or null",\n'
        '          "hashtags": ["#Example"]\n'
        "        }\n"
        "      ],\n"
        '      "cta": "CTA text or null",\n'
        '      "hashtags": ["#Example"],\n'
        '      "creative_brief": "Brief for this item.",\n'
        '      "alt_text": "Alt text for this item.",\n'
        '      "recommended_publish_window": {\n'
        '        "starts_at": "2026-01-05T10:00:00+02:00",\n'
        '        "ends_at": "2026-01-05T12:00:00+02:00",\n'
        '        "timezone": "Africa/Cairo"\n'
        "      },\n"
        '      "claim_sources": [\n'
        "        {\n"
        '          "claim_type": "business_fact",\n'
        '          "source_type": "profile",\n'
        '          "source_path": "business_profile.profile",\n'
        '          "approved": true\n'
        "        }\n"
        "      ],\n"
        '      "warnings": [],\n'
        '      "blockers": [],\n'
        '      "asset_required": false,\n'
        '      "asset_ids": [],\n'
        '      "generation_provenance": {\n'
        '        "generation_run_id": "<valid uuid>",\n'
        '        "provider_name": "<provider name>",\n'
        '        "provider_model": "<model name>",\n'
        '        "generated_at": "2026-01-05T09:00:00+02:00"\n'
        "      },\n"
        '      "version_checksum": "<sha256 hex string>",\n'
        '      "created_at": "2026-01-05T09:00:00+02:00"\n'
        "    }\n"
        "  ]\n"
        "}\n"
        "```"
    )
