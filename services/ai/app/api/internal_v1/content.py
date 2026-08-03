"""Internal FastAPI routes for Content generation, revision, and static assets."""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Body, Depends, HTTPException
from pydantic import BaseModel, ConfigDict

from content_contracts import (
    AiContentGenerateRequest,
    AiContentGenerateResponse,
    AiContentReviseRequest,
    AiContentReviseResponse,
    AiStaticAssetGenerateRequest,
    AiStaticAssetGenerateResponse,
    ContentPack,
    ContentValidationIssue,
    ContentValidationResult,
    ContentItemVersion,
)

from app.content.assembler import (
    assemble_asset_prompt,
    assemble_generation_prompt,
    assemble_revision_prompt,
)
from app.content.image_provider import (
    create_static_image_provider,
    generate_static_asset,
)
from app.content.observability import content_event_metadata
from app.content.service import (
    generate_content_pack_with_repair,
    revise_content_item_with_repair,
)
from app.content.storage import create_asset_storage
from app.content.validators import (
    validate_content_generation_request,
    validate_generated_content_pack,
    validate_revision_item,
)
from app.core.config import Settings, get_settings
from app.core.logging import log_content_event
from app.providers.base import ProviderError
from app.providers.content_provider import create_content_provider


router = APIRouter(prefix="/internal/v1/ai/content", tags=["internal-ai-content"])
logger = logging.getLogger(__name__)

_VALUE_ERROR_CODES = {
    "CONTENT_SCHEMA_FAILURE",
    "CONTENT_VERSION_CONFLICT",
    "CONTENT_POLICY_VIOLATION",
    "CONTENT_CHANNEL_MISMATCH",
    "CONTENT_OFFER_UNAPPROVED",
}


class ContentRevisionRequestEnvelope(BaseModel):
    """Internal handoff carrying the read-only version NestJS loaded by ID."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    request: AiContentReviseRequest
    previous_item_version: ContentItemVersion
    generation_request: AiContentGenerateRequest


def _raise_content_http_error(
    code: str,
    message: str,
    *,
    status_code: int = 422,
    field: str | None = None,
    retryable: bool = False,
) -> None:
    detail = {
        "error_type": code,
        "message": message,
        "retryable": retryable,
    }
    if field is not None:
        detail["field"] = field
    raise HTTPException(status_code=status_code, detail=detail)


def _raise_provider_error(error: ProviderError) -> None:
    code = error.code
    if code not in {
        "CONTENT_SCHEMA_FAILURE",
        "CONTENT_VERSION_CONFLICT",
        "CONTENT_POLICY_VIOLATION",
        "CONTENT_ASSET_REQUIRED",
        "CONTENT_OFFER_UNAPPROVED",
        "CONTENT_CHANNEL_MISMATCH",
        "CONTENT_UNSUPPORTED_CLAIM",
    }:
        code = "CONTENT_PROVIDER_FAILURE"
    _raise_content_http_error(
        code,
        str(error),
        status_code=503 if error.retryable else 422,
        retryable=error.retryable,
    )


def _raise_value_error(error: ValueError, *, default_code: str) -> None:
    """Preserve a stable assembler error code without exposing arbitrary data."""
    message = str(error)
    prefix, separator, remainder = message.partition(":")
    code = prefix if prefix in _VALUE_ERROR_CODES else default_code
    safe_message = remainder.strip() if separator and code == prefix else message
    _raise_content_http_error(code, safe_message)


def _raise_validation(validation: ContentValidationResult) -> None:
    issue = validation.issues[0]
    _raise_content_http_error(
        issue.code,
        issue.message,
        field=issue.field,
        retryable=issue.retryable,
    )


def _build_draft_pack(
    request: AiContentGenerateRequest,
    items: list[ContentItemVersion],
) -> ContentPack:
    now = datetime.now(timezone.utc)
    return ContentPack(
        id=request.content_pack_id,
        contract_version="content-v1",
        content_cycle_id=request.week_context.content_cycle_id,
        weekly_claim_id=request.week_context.weekly_claim_id,
        week_number=request.week_context.week_number,
        business_id=request.business_id,
        strategy_id=request.strategy_id,
        strategy_version=request.strategy_version,
        strategy_decision_id=request.strategy_decision_id,
        profile_version_id=request.business_profile.id,
        week_context_id=request.week_context.id,
        status="draft",
        retry_eligible=False,
        item_ids=[item.content_item_id for item in items],
        created_at=now,
        updated_at=now,
    )


def _model_name(settings: Settings) -> str:
    if settings.ai_provider_mode == "openai":
        return settings.openai_model
    if settings.ai_provider_mode == "gemini_dev":
        return settings.gemini_model
    if settings.ai_provider_mode == "openrouter":
        return settings.open_router_model
    return "mock-content-model"


@router.post(
    "/generate",
    response_model=AiContentGenerateResponse,
    summary="Generate grounded Content pack",
)
async def generate_content(
    request: AiContentGenerateRequest = Body(...),
    settings: Settings = Depends(get_settings),
) -> AiContentGenerateResponse:
    validation = validate_content_generation_request(request)
    if not validation.valid:
        _raise_validation(validation)

    try:
        prompt = assemble_generation_prompt(
            request,
            provider_name=settings.ai_provider_mode,
            model=_model_name(settings),
        )
        log_content_event(
            logger,
            "generation_started",
            content_event_metadata(prompt.metadata),
        )
        provider = create_content_provider(settings)
        items = await generate_content_pack_with_repair(
            provider,
            prompt,
            request=request,
        )
    except ProviderError as error:
        _raise_provider_error(error)
    except ValueError as error:
        _raise_value_error(error, default_code="CONTENT_SCHEMA_FAILURE")

    validation = validate_generated_content_pack(
        request,
        items,
        enforce_asset_readiness=False,
    )
    if not validation.valid:
        _raise_validation(validation)
    log_content_event(
        logger,
        "generation_completed",
        content_event_metadata(
            prompt.metadata,
            item_count=len(items),
            validation=validation,
        ),
    )
    return AiContentGenerateResponse(
        contract_version="content-v1",
        content_pack=_build_draft_pack(request, items),
        item_versions=items,
        validation=validation,
    )


@router.post(
    "/revise",
    response_model=AiContentReviseResponse,
    summary="Revise one Content item version",
)
async def revise_content(
    envelope: ContentRevisionRequestEnvelope = Body(...),
    settings: Settings = Depends(get_settings),
) -> AiContentReviseResponse:
    request = envelope.request
    try:
        prompt = assemble_revision_prompt(
            request,
            envelope.previous_item_version,
            provider_name=settings.ai_provider_mode,
            model=_model_name(settings),
            generation_request=envelope.generation_request,
        )
        log_content_event(
            logger,
            "revision_started",
            content_event_metadata(prompt.metadata),
        )
        provider = create_content_provider(settings)
        item = await revise_content_item_with_repair(
            provider,
            prompt,
            base_item_version=envelope.previous_item_version,
            generation_request=envelope.generation_request,
        )
    except ProviderError as error:
        _raise_provider_error(error)
    except ValueError as error:
        _raise_value_error(error, default_code="CONTENT_VERSION_CONFLICT")

    validation = validate_revision_item(
        envelope.previous_item_version,
        item,
        envelope.generation_request,
    )
    if not validation.valid:
        _raise_validation(validation)
    log_content_event(
        logger,
        "revision_completed",
        content_event_metadata(prompt.metadata, validation=validation),
    )
    return AiContentReviseResponse(
        contract_version="content-v1",
        item_version=item,
        validation=validation,
    )


@router.post(
    "/assets/generate-static",
    response_model=AiStaticAssetGenerateResponse,
    summary="Generate one static Content asset",
)
async def generate_static_content_asset(
    request: AiStaticAssetGenerateRequest = Body(...),
    settings: Settings = Depends(get_settings),
) -> AiStaticAssetGenerateResponse:
    try:
        prompt = assemble_asset_prompt(
            request,
            provider_name=settings.image_provider_mode,
            model=settings.image_model,
        )
        log_content_event(
            logger,
            "asset_generation_started",
            content_event_metadata(prompt.metadata),
        )
        asset = await generate_static_asset(
            request,
            prompt,
            create_static_image_provider(settings),
            create_asset_storage(
                root=settings.content_asset_storage_dir,
                allow_test_memory=settings.image_provider_mode in {"mock", "unavailable"},
            ),
        )
    except ValueError as error:
        _raise_content_http_error("CONTENT_SCHEMA_FAILURE", str(error))

    if asset.status == "ready":
        validation = ContentValidationResult(valid=True, issues=[])
    else:
        validation = ContentValidationResult(
            valid=False,
            issues=[
                ContentValidationIssue(
                    code=asset.failure_code or "CONTENT_PROVIDER_FAILURE",
                    field="asset.status",
                    message="Static asset is not publication-ready.",
                    retryable=asset.status == "failed",
                )
            ],
        )
    log_content_event(
        logger,
        "asset_generation_completed",
        content_event_metadata(prompt.metadata, validation=validation),
    )
    return AiStaticAssetGenerateResponse(
        contract_version="content-v1",
        asset=asset,
        validation=validation,
    )
