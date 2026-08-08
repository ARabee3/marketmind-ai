"""Content v2 full-draft generation from a frozen snapshot (issue #187).

The worker receives the transactionally frozen plan/profile/CTA/media
snapshot and reuses the proven content-v1 generation pipeline by projecting
it into the v1 request shape. A deterministic plan-alignment validator then
enforces that every generated item matches its frozen post card exactly
(channel, format, count), so generation never drifts from the owner's plan.
"""

from __future__ import annotations

import copy
import json
import uuid
from datetime import datetime, timezone
from typing import Any

from content_contracts import (
    AiContentGenerateRequest,
    AiContentReviseRequest,
    ContentCtaDestination,
    ContentItemVersion,
    ContentValidationIssue,
    ContentValidationResult,
    ContentWeekContext,
)
from content_v2_contracts import (
    AiContentV2GenerateRequest,
    AiContentV2GenerateResponse,
    AiContentV2ReviseRequest,
    AiContentV2ReviseResponse,
    ContentItemVersionV2,
    ContentVersionEditMetadataV2,
    ContentPackV2,
    ContentCycleV2,
)
from strategy_contracts import BusinessProfilePayload

from app.content.assembler import (
    assemble_generation_prompt,
    assemble_revision_prompt,
    PromptAssembly,
)
from app.content.circuit_breaker import CircuitBreaker
from app.content.service import (
    generate_content_pack_with_repair,
    revise_content_item_with_repair,
)
from app.content.validators import (
    validate_generated_content_pack,
    validate_revision_item,
)
from app.providers.base import ProviderError
from app.providers.content_provider import ContentLLMProvider

PLAN_ALIGNMENT_RULES = """
## Frozen post-plan alignment (content-v2)

- Produce exactly {plan_count} item versions, one per supplied post_plans card, in the same order.
- Item i must use exactly post_plans[i].channel and post_plans[i].format.
- Ground each item in its card's purpose, owner_instructions, visual_direction, CTA, and selected media.
- Do not add, drop, reorder, or merge cards. Do not change a card's channel or format.
"""


def _deterministic_week_context_id(frozen_input: Any) -> str:
    return str(
        uuid.uuid5(
            uuid.NAMESPACE_URL,
            f"{frozen_input.content_cycle_id}:week:{frozen_input.week_number}:context",
        )
    )


def v2_generate_to_v1_request(
    request: AiContentV2GenerateRequest,
) -> AiContentGenerateRequest:
    """Project the frozen v2 snapshot into the v1 pipeline's request shape.

    The v1 pipeline consumes a week context; the v2 frozen owner inputs live
    on the post cards, so the synthetic context is deliberately empty of v1
    promotion/instruction fields and carries only identity + dates.
    """
    frozen = request.frozen_input
    handoff = request.strategy_plan.content_handoff
    if not handoff.available:
        raise ValueError(
            "CONTENT_SCHEMA_FAILURE: strategy_plan.content_handoff: "
            "generation requires a usable content handoff."
        )
    handoff_week = next(
        (week for week in handoff.weeks if week.week_number == frozen.week_number),
        None,
    )
    if handoff_week is None:
        raise ValueError(
            "CONTENT_SCHEMA_FAILURE: frozen_input.week_number: "
            "the week is missing from the approved Strategy handoff."
        )
    channels = list({plan.channel for plan in frozen.post_plans})
    if not channels:
        channels = list(handoff.channels)
    formats = list(handoff_week.formats)
    now = datetime.now(timezone.utc)
    context = ContentWeekContext(
        id=_deterministic_week_context_id(frozen),
        contract_version="content-v1",
        content_cycle_id=frozen.content_cycle_id,
        week_number=frozen.week_number,
        week_start_date=frozen.week_start_date,
        promotion_mode="none",
        promotion=None,
        must_include=[],
        must_avoid=[],
        approved_asset_ids=[
            media_id
            for plan in frozen.post_plans
            for media_id in plan.selected_media_ids
        ],
        cta_destination=ContentCtaDestination(type="none", value=None),
        context_source="system_defaulted",
        confirmed_by_user_id=None,
        confirmed_at=None,
        system_defaulted_at=now,
        generation_cutoff_at=now,
        weekly_claim_id=frozen.weekly_claim_id,
    )
    business_profile = BusinessProfilePayload.model_validate(
        request.business_profile
    )
    return AiContentGenerateRequest(
        contract_version="content-v1",
        content_pack_id=request.content_pack_id,
        business_id=request.business_id,
        strategy_id=request.strategy_id,
        strategy_version=request.strategy_version,
        strategy_decision_id=request.strategy_decision_id,
        strategy_plan=request.strategy_plan,
        business_profile=business_profile,
        week_context=context,
        selected_channels=channels,
        allowed_formats=formats,
        language_mode=request.language_mode,
    )


def assemble_v2_generation_prompt(
    request: AiContentV2GenerateRequest,
    v1_request: AiContentGenerateRequest,
    provider_name: str,
    model: str,
) -> PromptAssembly:
    """Assemble the v1 generation prompt plus frozen post-plan alignment."""
    base = assemble_generation_prompt(v1_request, provider_name, model)
    plan_payloads = [
        plan.model_dump(mode="json") for plan in request.frozen_input.post_plans
    ]
    plan_json = json.dumps(plan_payloads, ensure_ascii=False, indent=2)
    rules = PLAN_ALIGNMENT_RULES.format(plan_count=len(plan_payloads))
    context = copy.deepcopy(base.context)
    context["grounding_inputs"]["post_plans"] = plan_payloads
    return PromptAssembly(
        system_prompt=base.system_prompt + "\n\n" + rules,
        user_prompt=base.user_prompt + "\n\npost_plans:\n" + plan_json,
        metadata={
            **base.metadata,
            "contract_version": "content-v2",
            "frozen_input_hash": _sha256(plan_json),
        },
        context=context,
    )


def validate_plan_alignment(
    plans: list[Any],
    items: list[ContentItemVersion],
) -> ContentValidationResult:
    """Enforce one generated item per frozen card with matching channel/format."""
    issues: list[ContentValidationIssue] = []
    if len(items) != len(plans):
        issues.append(
            ContentValidationIssue(
                code="CONTENT_SCHEMA_FAILURE",
                field="item_versions",
                message=(
                    f"Generation produced {len(items)} items for "
                    f"{len(plans)} frozen post plans; the counts must match."
                ),
                retryable=True,
            )
        )
    else:
        for index, (plan, item) in enumerate(zip(plans, items)):
            if item.channel != plan.channel or item.format != plan.format:
                issues.append(
                    ContentValidationIssue(
                        code="CONTENT_CHANNEL_MISMATCH",
                        field=f"item_versions[{index}]",
                        message=(
                            f"Item {index + 1} uses {item.channel}/{item.format} "
                            f"but its frozen card requires "
                            f"{plan.channel}/{plan.format}."
                        ),
                        retryable=True,
                    )
                )
    return ContentValidationResult(valid=not issues, issues=issues)


def to_v2_item_version(
    item: ContentItemVersion,
    *,
    edit_kind: str = "generated",
    base_version_id: str | None = None,
    base_version_checksum: str | None = None,
) -> ContentItemVersionV2:
    """Tag a pipeline item version as an immutable validated v2 version."""
    data = item.model_dump(mode="json")
    data["contract_version"] = "content-v2"
    data["edit_metadata"] = ContentVersionEditMetadataV2(
        edit_kind=edit_kind,
        base_version_id=base_version_id,
        base_version_checksum=base_version_checksum,
        edited_by_user_id=None,
        validation_state="validated",
        edited_at=data["created_at"],
    ).model_dump(mode="json")
    return ContentItemVersionV2.model_validate(data)


def to_v1_item_version(item: ContentItemVersionV2) -> ContentItemVersion:
    """Strip v2-only fields back to the v1 pipeline surface."""
    data = item.model_dump(mode="json")
    data["contract_version"] = "content-v1"
    data.pop("edit_metadata", None)
    return ContentItemVersion.model_validate(data)


def _sha256(value: str) -> str:
    import hashlib

    return hashlib.sha256(value.encode("utf-8")).hexdigest()


async def generate_v2_content_pack(
    request: AiContentV2GenerateRequest,
    provider: ContentLLMProvider,
    breaker: CircuitBreaker | None,
) -> AiContentV2GenerateResponse:
    """Run the full-draft worker against the frozen snapshot."""
    v1_request = v2_generate_to_v1_request(request)
    prompt = assemble_v2_generation_prompt(
        request,
        v1_request,
        provider_name=provider.name,
        model=str(getattr(provider, "model", "unknown")),
    )
    items = await generate_content_pack_with_repair(
        provider,
        prompt,
        request=v1_request,
        breaker=breaker,
        extra_validator=lambda generated: validate_plan_alignment(
            request.frozen_input.post_plans, generated
        ),
    )
    validation = validate_generated_content_pack(
        v1_request,
        items,
        enforce_asset_readiness=False,
    )
    if not validation.valid:
        issue = validation.issues[0]
        raise ProviderError(
            issue.code,
            f"{issue.field}: {issue.message}",
            retryable=issue.retryable,
        )
    item_versions = [to_v2_item_version(item) for item in items]
    now = datetime.now(timezone.utc)
    frozen = request.frozen_input
    pack = ContentPackV2(
        id=request.content_pack_id,
        contract_version="content-v2",
        content_cycle_id=frozen.content_cycle_id,
        weekly_claim_id=frozen.weekly_claim_id,
        week_number=frozen.week_number,
        business_id=request.business_id,
        strategy_id=request.strategy_id,
        strategy_version=request.strategy_version,
        strategy_decision_id=request.strategy_decision_id,
        profile_version_id=BusinessProfilePayload.model_validate(
            request.business_profile
        ).id,
        status="draft",
        retry_eligible=False,
        item_ids=[item.content_item_id for item in item_versions],
        week_plan_id=frozen.week_plan_id,
        week_context_id=_deterministic_week_context_id(frozen),
        created_at=now,
        updated_at=now,
    )
    cycle = ContentCycleV2(
        id=frozen.content_cycle_id,
        contract_version="content-v2",
        business_id=request.business_id,
        strategy_id=request.strategy_id,
        strategy_version=request.strategy_version,
        strategy_decision_id=request.strategy_decision_id,
        profile_version_id=BusinessProfilePayload.model_validate(
            request.business_profile
        ).id,
        status="active",
        current_week_number=frozen.week_number,
        next_generation_at=None,
        timezone="Africa/Cairo",
        pause_reason=None,
        completed_at=None,
        created_at=now,
        updated_at=now,
    )
    return AiContentV2GenerateResponse(
        contract_version="content-v2",
        content_pack=pack,
        cycle=cycle,
        item_versions=item_versions,
        validation=validation,
    )


async def revise_v2_content_item(
    request: AiContentV2ReviseRequest,
    provider: ContentLLMProvider,
    breaker: CircuitBreaker | None,
) -> AiContentV2ReviseResponse:
    """AI rewrite (issue #187): reuse the v1 revision machinery against the
    frozen snapshot, then tag the result as an immutable ai_rewrite version."""
    v1_request = v2_generate_to_v1_request(request)
    v1_base = to_v1_item_version(request.base_item_version)
    v1_revise = AiContentReviseRequest(
        contract_version="content-v1",
        content_pack_id=request.content_pack_id,
        content_item_id=request.content_item_id,
        base_item_version_id=request.base_item_version.id,
        revision_notes=request.revision_notes,
        idempotency_key=request.idempotency_key,
    )
    prompt = assemble_revision_prompt(
        v1_revise,
        v1_base,
        provider_name=provider.name,
        model=str(getattr(provider, "model", "unknown")),
        generation_request=v1_request,
    )
    item = await revise_content_item_with_repair(
        provider,
        prompt,
        base_item_version=v1_base,
        generation_request=v1_request,
        breaker=breaker,
    )
    validation = validate_revision_item(v1_base, item, v1_request)
    if not validation.valid:
        issue = validation.issues[0]
        raise ProviderError(
            issue.code,
            f"{issue.field}: {issue.message}",
            retryable=issue.retryable,
        )
    v2_item = to_v2_item_version(
        item,
        edit_kind="ai_rewrite",
        base_version_id=request.base_item_version.id,
        base_version_checksum=request.base_item_version.version_checksum,
    )
    return AiContentV2ReviseResponse(
        contract_version="content-v2",
        item_version=v2_item,
        validation=validation,
    )
