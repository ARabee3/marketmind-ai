"""Refined prompt assembly for the Phase 6 real-provider spot-check.

The spot-check compares the deterministic fake-provider baseline against a real
provider.  The fake provider parses the JSON grounding context and always emits
contract-valid items.  Real providers need extra guardrails in the system
prompt so their structured output also satisfies the post-generation contract
validator.  This module builds a spot-check-specific prompt that leaves the
production generation prompt untouched.
"""

from __future__ import annotations

import json
from datetime import datetime, time, timedelta
from typing import Any
from zoneinfo import ZoneInfo

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

    language_note = (
        " It must be written in Arabic (Egyptian Arabic) because language_mode is ar-EG."
        if request.language_mode == "ar-EG"
        else (
            " It must be written in English because language_mode is en."
            if request.language_mode == "en"
            else ""
        )
    )
    if destination_type == "none":
        cta_rule = (
            "The weekly context has no CTA destination (type=none). "
            "Do not emit any CTA destination text."
        )
    elif destination_value:
        cta_rule = (
            "If the weekly context has a CTA destination, "
            f"the generated CTA copy must include the confirmed destination value: {destination_value!r}."
            f"{language_note} "
            "The CTA wording around the destination value must be in the same language as the caption "
            "(Arabic for ar-EG; English for en). Do not use English action words such as 'Order now', "
            "'WhatsApp', or 'Call us' in an Arabic CTA."
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

    promotion = request.week_context.promotion
    promotion_exact = (
        ""
        if request.week_context.promotion_mode != "owner_approved" or promotion is None
        else (
            "\n"
            f"  Promotion text to include verbatim: {promotion.text!r}\n"
            f"  Promotion terms to include verbatim: {[str(t) for t in promotion.terms]!r}\n"
            "  Add this exact claim_sources entry: "
            "claim_type='promotion', source_type='week_context', "
            "source_path='week_context.promotion', approved=true."
        )
    )
    promotion_rule = (
        "No weekly promotion is set; do not invent or mention any offer, discount, "
        "price, or promotion terms."
        if request.week_context.promotion_mode != "owner_approved" or promotion is None
        else (
            "The weekly context contains an owner-approved promotion. "
            "You must include the exact promotion text and every term verbatim "
            "in at least one caption. Do not add extra promotion details that are "
            "not in the supplied terms."
            f"{promotion_exact}"
        )
    )

    must_include_exact = (
        ""
        if not request.week_context.must_include
        else (
            "\n  The exact must_include SENTENCE to COPY CHARACTER-FOR-CHARACTER into at "
            + "least one caption (do not paraphrase, translate, or reword any part of it): "
            + f"{[str(v) for v in request.week_context.must_include]!r}"
        )
    )
    must_avoid_exact = (
        ""
        if not request.week_context.must_avoid
        else (
            "\n  The exact must_avoid text that must NOT appear anywhere: "
            + f"{[str(v) for v in request.week_context.must_avoid]!r}"
        )
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
            "5. `version` must be `1` for every generated item.",
            "6. `content_item_id` and `id` must be two different valid UUIDs. "
            "Never reuse either value across items.",
            f"7. `content_pack_id` must equal {request.content_pack_id!r}.",
            f"8. `strategy_trace.strategy_id` = {request.strategy_id!r}; "
            f"`strategy_trace.strategy_version` = {request.strategy_version!r}; "
            f"`strategy_trace.week_number` = {request.week_context.week_number}.",
            "9. `strategy_trace.channel` must match the item's `channel`.",
            f"10. `strategy_trace.pillar_ids` must be chosen only from {expected_pillars!r}.",
            f"11. `strategy_trace.objective` must equal exactly {objective_value!r}.",
            f"12. `language_mode` must equal {language_mode_value!r}; "
            f"`caption_variants` must include locale {expected_locale!r}. "
            "For language_mode=ar-EG, every owner-facing field "
            "(`caption`, `cta`, `creative_brief`, `alt_text`) must be predominantly Arabic. "
            "For language_mode=en, those fields must be predominantly English. "
            "Protected values such as phone numbers, URLs, handles, and approved owner text "
            "must be preserved exactly.",
            f"13. {cta_rule}",
            f"14. {promotion_rule}",
            "15. Obey every `week_context.must_include` instruction exactly: copy the whole "
            "sentence into one caption unchanged (same letters, same diacritics, same spacing). "
            "The validator checks that every substantive word of the instruction appears in the "
            "caption text. Never include any `week_context.must_avoid` text."
            f"{must_include_exact}{must_avoid_exact}",
            "15b. Protected owner or business values (business name, phone, WhatsApp number, URL, "
            "handle, address) must be used exactly as provided in the request or omitted entirely. "
            "Do not translate, transliterate, or rewrite them into Arabic script or a different form. "
            "For example, if the business name is supplied in Latin characters, keep it in Latin "
            "characters; if the phone number is '+201000000000', do not shorten or reformat it.",
            "15a. The CTA must include the confirmed destination value exactly as shown above; "
            "do not shorten, reformat, or drop the phone number / URL / handle.",
            f"16. `recommended_publish_window.starts_at` and `ends_at` must be "
            f"timezone-aware ISO-8601 datetimes between {week_start.isoformat()} "
            f"and {week_end.isoformat()}, with `ends_at` > `starts_at`.",
            "17. Every `hashtags` array must contain only strings that start with `#` and contain no whitespace (e.g. `[\"#MarketMind\", \"#SmallBusiness\"]`).",
            "18. `generation_provenance.generation_run_id` must be a valid UUID string.",
            "19. Every item must include at least one `claim_sources` entry.",
            "20. `item.hashtags` must match the primary caption variant's `hashtags`.",
            "21. `item.cta` must match the primary caption variant's `cta`.",
            "",
            "Return only the structured JSON object requested by the caller.",
        ]
    )

    example = _spot_check_one_shot_example(request)
    refined_system_prompt = "\n\n".join(
        [base.system_prompt, supplement, example]
    )

    return PromptAssembly(
        system_prompt=refined_system_prompt,
        user_prompt=base.user_prompt,
        metadata=base.metadata,
    )


def _spot_check_one_shot_example(request: AiContentGenerateRequest) -> str:
    """Return valid JSON using representative values from the real request."""
    language_mode_value = (
        request.language_mode.value
        if hasattr(request.language_mode, "value")
        else request.language_mode
    )
    expected_locale = "ar" if language_mode_value == "ar-EG" else "en"
    dialect = "masry" if expected_locale == "ar" else "neutral"

    cta_destination = request.week_context.cta_destination
    destination_type = (
        cta_destination.type.value
        if hasattr(cta_destination.type, "value")
        else cta_destination.type
    )
    destination_value = cta_destination.value or ""
    cta_text: str | None = None
    if destination_type != "none" and destination_value:
        cta_text = (
            f"Contact us: {destination_value}"
            if language_mode_value == "en"
            else f"تواصل معنا: {destination_value}"
        )

    promotion = request.week_context.promotion
    promotion_text = promotion.text if promotion else ""
    promotion_terms = [str(term) for term in promotion.terms] if promotion else []
    must_include = [str(value) for value in request.week_context.must_include]

    business_name = ""
    profile = request.business_profile.profile
    if isinstance(profile, dict):
        business_name = profile.get("business_name", "")
    elif hasattr(profile, "business_name"):
        business_name = getattr(profile, "business_name", "")

    if language_mode_value == "en":
        caption_parts = ["Discover this week's approved content idea."]
        creative_brief = "A clear weekly post with practical, grounded copy."
        alt_text = "A clear visual for the approved weekly content idea."
        rationale = "A weekday evening aligns with the intended audience window."
    else:
        caption_parts = ["اكتشف فكرة المحتوى المعتمدة لهذا الأسبوع."]
        creative_brief = "منشور أسبوعي واضح بنص عملي ومبني على المعلومات المؤكدة."
        alt_text = "تصميم واضح لفكرة المحتوى المعتمدة لهذا الأسبوع."
        rationale = "موعد مسائي خلال الأسبوع يناسب نافذة الجمهور المستهدف."
    if business_name:
        caption_parts.insert(0, str(business_name))
    if promotion_text:
        caption_parts.append(str(promotion_text))
    caption_parts.extend(promotion_terms)
    caption_parts.extend(must_include)
    if cta_text:
        caption_parts.append(cta_text)
    caption_example = " ".join(caption_parts)

    cairo = ZoneInfo("Africa/Cairo")
    starts_at = datetime.combine(
        request.week_context.week_start_date,
        time(hour=18),
        tzinfo=cairo,
    )
    ends_at = starts_at + timedelta(hours=2)
    generated_at = starts_at - timedelta(hours=1)
    objective_value = str(
        getattr(
            request.strategy_plan.primary_objective,
            "value",
            request.strategy_plan.primary_objective,
        )
    )
    pillar_ids = derive_strategy_pillar_ids(
        request.strategy_id,
        len(request.strategy_plan.content_strategy.pillars),
    )
    claim_sources: list[dict[str, Any]] = [
        {
            "claim_type": "business_fact",
            "source_type": "profile",
            "source_path": "business_profile.profile",
            "approved": True,
        }
    ]
    if promotion is not None:
        claim_sources.append(
            {
                "claim_type": "promotion",
                "source_type": "week_context",
                "source_path": "week_context.promotion",
                "approved": True,
            }
        )

    channel = request.selected_channels[0]
    content_format = request.allowed_formats[0]
    example = {
        "item_versions": [
            {
                "id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                "contract_version": "content-v1",
                "content_item_id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
                "content_pack_id": str(request.content_pack_id),
                "version": 1,
                "channel": channel,
                "format": content_format,
                "language_mode": language_mode_value,
                "strategy_trace": {
                    "strategy_id": str(request.strategy_id),
                    "strategy_version": request.strategy_version,
                    "week_number": request.week_context.week_number,
                    "pillar_ids": pillar_ids[:1],
                    "objective": objective_value,
                    "channel": channel,
                    "funnel_stage": "awareness",
                    "content_purpose": "Introduce the approved weekly idea.",
                },
                "caption_variants": [
                    {
                        "locale": expected_locale,
                        "dialect": dialect,
                        "caption": caption_example,
                        "cta": cta_text,
                        "hashtags": ["#Example"],
                    }
                ],
                "cta": cta_text,
                "hashtags": ["#Example"],
                "creative_brief": creative_brief,
                "alt_text": alt_text,
                "short_video_script": None,
                "recommended_publish_window": {
                    "starts_at": starts_at.isoformat(),
                    "ends_at": ends_at.isoformat(),
                    "timezone": "Africa/Cairo",
                    "day_preference": "weekday",
                    "time_of_day_hint": "evening",
                    "rationale": rationale,
                },
                "claim_sources": claim_sources,
                "warnings": [],
                "blockers": [],
                "asset_required": content_format
                in {"static_image_post", "carousel_brief"},
                "asset_ids": [],
                "generation_provenance": {
                    "generation_run_id": "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
                    "provider_name": "provider-name",
                    "provider_model": "provider-model",
                    "generated_at": generated_at.isoformat(),
                },
                "version_checksum": "0" * 64,
                "created_at": generated_at.isoformat(),
            }
        ]
    }

    return (
        "## Example of a valid spot-check item (use the real request values above, "
        "not the placeholder identities):\n\n"
        "```json\n"
        f"{json.dumps(example, ensure_ascii=False, indent=2)}\n"
        "```"
    )
