"""Bounded Content provider retry and structured-output repair orchestration."""

from __future__ import annotations

import asyncio
import logging
import uuid
from collections.abc import Awaitable, Callable
from datetime import datetime, timezone
from typing import Any

from content_contracts import AiContentGenerateRequest, ContentItemVersion
from platform_constraints import validate_platform_constraints

from app.content.assembler import PromptAssembly
from app.content.circuit_breaker import CircuitBreaker
from app.providers.base import ProviderError
from app.providers.content_provider import ContentLLMProvider
from app.content.validators import (
    compute_content_item_checksum,
    validate_generated_content_pack,
    validate_revision_item,
)


MAX_CONTENT_ATTEMPTS = 3
logger = logging.getLogger(__name__)
_SCHEMA_ERROR_CODES = {
    "CONTENT_SCHEMA_FAILURE",
    "AI_PROVIDER_INVALID_OUTPUT",
}
_REPAIRABLE_OUTPUT_CODES = {
    *_SCHEMA_ERROR_CODES,
    "CONTENT_ASSET_REQUIRED",
    "CONTENT_CHANNEL_MISMATCH",
    "CONTENT_OFFER_UNAPPROVED",
    "CONTENT_POLICY_VIOLATION",
    "CONTENT_UNSUPPORTED_CLAIM",
    "CONTENT_VERSION_CONFLICT",
}


def _repair_prompt(prompt: PromptAssembly, error: ProviderError, attempt: int) -> PromptAssembly:
    return PromptAssembly(
        system_prompt=(
            f"{prompt.system_prompt}\n\n"
            "STRUCTURED OUTPUT REPAIR: The previous response failed deterministic "
            "content-v1 validation. Regenerate the complete requested output. "
            "Do not return a patch, explanation, approval, or publishing decision."
        ),
        user_prompt=(
            f"{prompt.user_prompt}\n\n"
            "The previous output failed with this safe validation summary:\n"
            f"code={error.code}\nmessage={str(error)}\n"
            "Return the complete corrected structured output."
        ),
        metadata={
            **prompt.metadata,
            "repair_attempt": attempt,
            "repair_error_code": error.code,
        },
        context=prompt.context,
    )


def _validate_pack_shape(items: object) -> None:
    if not isinstance(items, list) or not all(
        isinstance(item, ContentItemVersion) for item in items
    ):
        raise ProviderError(
            "CONTENT_SCHEMA_FAILURE",
            "Content generation must return a list of ContentItemVersion objects.",
            retryable=False,
        )
    if not 3 <= len(items) <= 5:
        raise ProviderError(
            "CONTENT_SCHEMA_FAILURE",
            "Content generation must return between 3 and 5 item versions.",
            retryable=False,
        )


def _ensure_provider_allowed(breaker: CircuitBreaker | None) -> None:
    if breaker is not None and not breaker.allow():
        raise ProviderError(
            "CONTENT_PROVIDER_FAILURE",
            "Content provider circuit breaker is open; refusing provider call.",
            retryable=True,
        )
def _provider_model(provider: ContentLLMProvider, prompt: PromptAssembly) -> str:
    return str(getattr(provider, "model", prompt.metadata.get("model", "unknown")))


def _generation_run_id(
    provider: ContentLLMProvider,
    prompt: PromptAssembly,
) -> str:
    return str(
        uuid.uuid5(
            uuid.NAMESPACE_URL,
            ":".join(
                (
                    "content-generation-run",
                    provider.name,
                    _provider_model(provider, prompt),
                    str(prompt.metadata.get("input_snapshot_hash", "")),
                )
            ),
        )
    )


def _with_checksum(item: ContentItemVersion) -> ContentItemVersion:
    without_checksum = item.model_copy(update={"version_checksum": ""})
    return without_checksum.model_copy(
        update={"version_checksum": compute_content_item_checksum(without_checksum)}
    )


def _with_platform_constraint_warning(
    item: ContentItemVersion,
) -> ContentItemVersion:
    """Canonicalize the advisory platform warning on a finalized item."""
    warnings = [
        code for code in item.warnings if code != "CONTENT_PLATFORM_CONSTRAINT"
    ]
    if validate_platform_constraints(item.model_dump(mode="json")):
        warnings.append("CONTENT_PLATFORM_CONSTRAINT")
    return item.model_copy(update={"warnings": warnings})


def _finalize_generated_items(
    request: AiContentGenerateRequest,
    items: list[ContentItemVersion],
    provider: ContentLLMProvider,
    prompt: PromptAssembly,
) -> list[ContentItemVersion]:
    generated_at = datetime.now(timezone.utc)
    run_id = _generation_run_id(provider, prompt)
    approved_asset_ids = set(request.week_context.approved_asset_ids)
    finalized: list[ContentItemVersion] = []
    for index, item in enumerate(items, start=1):
        content_item_id = str(
            uuid.uuid5(
                uuid.NAMESPACE_URL,
                f"{request.content_pack_id}:content-item:{index}",
            )
        )
        item_version_id = str(
            uuid.uuid5(uuid.NAMESPACE_URL, f"{content_item_id}:version:1")
        )
        trace = item.strategy_trace.model_copy(
            update={
                "strategy_id": request.strategy_id,
                "strategy_version": request.strategy_version,
                "week_number": request.week_context.week_number,
                "objective": str(
                    getattr(
                        request.strategy_plan.primary_objective,
                        "value",
                        request.strategy_plan.primary_objective,
                    )
                ),
                "channel": item.channel,
            }
        )
        provenance = item.generation_provenance.model_copy(
            update={
                "generation_run_id": run_id,
                "provider_name": provider.name,
                "provider_model": _provider_model(provider, prompt),
                "generated_at": generated_at,
            }
        )
        asset_ids = (
            [asset_id for asset_id in item.asset_ids if asset_id in approved_asset_ids]
            if item.asset_required
            else []
        )
        blockers = list(item.blockers)
        if item.asset_required and not asset_ids and "CONTENT_ASSET_REQUIRED" not in blockers:
            blockers.append("CONTENT_ASSET_REQUIRED")
        staged = item.model_copy(
            update={
                "id": item_version_id,
                "content_item_id": content_item_id,
                "content_pack_id": request.content_pack_id,
                "version": 1,
                "strategy_trace": trace,
                "asset_ids": asset_ids,
                "blockers": blockers,
                "generation_provenance": provenance,
                "created_at": generated_at,
            }
        )
        finalized.append(_with_checksum(_with_platform_constraint_warning(staged)))
    return finalized


def _finalize_revised_item(
    base_item_version: ContentItemVersion,
    item: ContentItemVersion,
    provider: ContentLLMProvider,
    prompt: PromptAssembly,
) -> ContentItemVersion:
    generated_at = datetime.now(timezone.utc)
    next_version = base_item_version.version + 1
    item_version_id = str(
        uuid.uuid5(
            uuid.NAMESPACE_URL,
            f"{base_item_version.content_item_id}:version:{next_version}",
        )
    )
    provenance = item.generation_provenance.model_copy(
        update={
            "generation_run_id": _generation_run_id(provider, prompt),
            "provider_name": provider.name,
            "provider_model": _provider_model(provider, prompt),
            "generated_at": generated_at,
        }
    )
    staged = item.model_copy(
        update={
            "id": item_version_id,
            "version": next_version,
            "generation_provenance": provenance,
            "created_at": generated_at,
        }
    )
    return _with_checksum(_with_platform_constraint_warning(staged))


async def generate_content_pack_with_repair(
    provider: ContentLLMProvider,
    prompt: PromptAssembly,
    *,
    request: AiContentGenerateRequest | None = None,
    max_attempts: int = MAX_CONTENT_ATTEMPTS,
    sleep: Callable[[float], Awaitable[Any]] = asyncio.sleep,
    retry_delay_seconds: float = 2.0,
    breaker: CircuitBreaker | None = None,
) -> list[ContentItemVersion]:
    """Generate a complete pack with bounded schema repair and safe retry."""
    _ensure_provider_allowed(breaker)
    current_prompt = prompt
    last_error: ProviderError | None = None
    for attempt in range(1, max_attempts + 1):
        try:
            items = await provider.generate_content_pack(current_prompt)
            _validate_pack_shape(items)
            if request is not None:
                items = _finalize_generated_items(request, items, provider, current_prompt)
            if request is not None:
                validation = validate_generated_content_pack(
                    request,
                    items,
                    enforce_asset_readiness=False,
                )
                if not validation.valid:
                    issue = validation.issues[0]
                    raise ProviderError(
                        issue.code,
                        f"{issue.field}: {issue.message}",
                        retryable=False,
                    )
            if breaker is not None:
                breaker.record_success()
            return items
        except ProviderError as error:
            if breaker is not None and error.retryable:
                breaker.record_failure()
            last_error = error
            logger.warning(
                "content repair_or_retry attempt=%d code=%s message=%s",
                attempt,
                error.code,
                error,
            )
            if attempt == max_attempts:
                break
            if error.code in _REPAIRABLE_OUTPUT_CODES:
                current_prompt = _repair_prompt(prompt, error, attempt)
            elif error.retryable:
                await sleep(retry_delay_seconds * (2 ** (attempt - 1)))
            else:
                break

    if last_error is None:
        raise ProviderError(
            "CONTENT_PROVIDER_FAILURE",
            "Content provider attempts ended without a result.",
            retryable=True,
        )
    if last_error.code in _SCHEMA_ERROR_CODES:
        raise ProviderError(
            "CONTENT_SCHEMA_FAILURE",
            "Content provider output remained invalid after bounded repair.",
            retryable=False,
        ) from last_error
    if last_error.code in _REPAIRABLE_OUTPUT_CODES:
        raise ProviderError(
            last_error.code,
            "Content provider output remained unsafe after bounded repair.",
            retryable=False,
        ) from last_error
    if last_error.retryable:
        raise ProviderError(
            "CONTENT_PROVIDER_FAILURE",
            "Content provider remained unavailable after bounded retries.",
            retryable=True,
        ) from last_error
    raise last_error


async def revise_content_item_with_repair(
    provider: ContentLLMProvider,
    prompt: PromptAssembly,
    *,
    base_item_version: ContentItemVersion | None = None,
    generation_request: AiContentGenerateRequest | None = None,
    max_attempts: int = MAX_CONTENT_ATTEMPTS,
    sleep: Callable[[float], Awaitable[Any]] = asyncio.sleep,
    retry_delay_seconds: float = 2.0,
    breaker: CircuitBreaker | None = None,
) -> ContentItemVersion:
    """Revise one item with the same bounded provider safety policy."""
    _ensure_provider_allowed(breaker)
    current_prompt = prompt
    last_error: ProviderError | None = None
    for attempt in range(1, max_attempts + 1):
        try:
            item = await provider.revise_content_item(current_prompt)
            if not isinstance(item, ContentItemVersion):
                raise ProviderError(
                    "CONTENT_SCHEMA_FAILURE",
                    "Content revision did not return one ContentItemVersion.",
                    retryable=False,
                )
            if base_item_version is not None:
                item = _finalize_revised_item(
                    base_item_version,
                    item,
                    provider,
                    current_prompt,
                )
                validation = validate_revision_item(
                    base_item_version,
                    item,
                    generation_request,
                )
                if not validation.valid:
                    issue = validation.issues[0]
                    raise ProviderError(
                        issue.code,
                        f"{issue.field}: {issue.message}",
                        retryable=False,
                    )
            if breaker is not None:
                breaker.record_success()
            return item
        except ProviderError as error:
            if breaker is not None and error.retryable:
                breaker.record_failure()
            last_error = error
            logger.warning(
                "content revision repair_or_retry attempt=%d code=%s message=%s",
                attempt,
                error.code,
                error,
            )
            if attempt == max_attempts:
                break
            if error.code in _REPAIRABLE_OUTPUT_CODES:
                current_prompt = _repair_prompt(prompt, error, attempt)
            elif error.retryable:
                await sleep(retry_delay_seconds * (2 ** (attempt - 1)))
            else:
                break

    if last_error is None:
        raise ProviderError(
            "CONTENT_PROVIDER_FAILURE",
            "Content revision attempts ended without a result.",
            retryable=True,
        )
    if last_error.code in _SCHEMA_ERROR_CODES:
        raise ProviderError(
            "CONTENT_SCHEMA_FAILURE",
            "Content revision remained invalid after bounded repair.",
            retryable=False,
        ) from last_error
    if last_error.code in _REPAIRABLE_OUTPUT_CODES:
        raise ProviderError(
            last_error.code,
            "Content revision remained unsafe after bounded repair.",
            retryable=False,
        ) from last_error
    if last_error.retryable:
        raise ProviderError(
            "CONTENT_PROVIDER_FAILURE",
            "Content revision provider remained unavailable after bounded retries.",
            retryable=True,
        ) from last_error
    raise last_error
