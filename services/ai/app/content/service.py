"""Bounded Content provider retry and structured-output repair orchestration."""

from __future__ import annotations

import asyncio
import inspect
import logging
import uuid
from collections.abc import Awaitable, Callable
from datetime import datetime, timezone
from typing import Any

from content_contracts import (
    AiContentGenerateRequest,
    ContentItemVersion,
    ContentValidationResult,
)
from platform_constraints import validate_platform_constraints

from app.content.assembler import PromptAssembly
from app.content.circuit_breaker import CircuitBreaker
from app.content.validators import (
    compute_content_item_checksum,
    validate_generated_content_pack,
    validate_revision_item,
)
from app.providers.base import ProviderError
from app.providers.content_provider import ContentLLMProvider

# Keep one local repair pass for deterministic output violations. Transient
# provider failures still use the existing retry policy and are not multiplied
# by an unbounded local loop.
MAX_CONTENT_ATTEMPTS = 2
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


def _repair_prompt(
    prompt: PromptAssembly, error: ProviderError, attempt: int
) -> PromptAssembly:
    claim_repair = ""
    if error.code == "CONTENT_UNSUPPORTED_CLAIM":
        claim_repair = (
            "\n\nUnsupported-claim repair: remove every unsupported price, availability, "
            "opening-hours, superiority, testimonial, or competitor claim from the "
            "complete output. Do not invent a replacement fact. Only keep a risky "
            "claim when the exact value appears in the supplied approved grounding "
            "source and claim_sources points to that source; otherwise rewrite the "
            "sentence as a factual, non-claiming statement."
        )
    protected_text_repair = ""
    if error.code == "CONTENT_POLICY_VIOLATION":
        protected_text_repair = (
            "\n\nProtected-text repair: when business names, addresses, handles, "
            "phone numbers, WhatsApp values, or URLs are used, copy the supplied "
            "canonical value exactly. Do not translate, reformat, or paraphrase it. "
            "Omit the value when it is not needed."
        )
    safe_copy_mode = ""
    if attempt >= 1:
        safe_copy_mode = (
            "\n\nFINAL SAFE COPY MODE: prefer plain factual wording. Remove every "
            "price, stock, opening-hours, superiority, testimonial, guarantee, "
            "regulated, sponsored, and competitor claim unless the exact approved "
            "value and source path are supplied. Preserve canonical business values "
            "exactly and do not invent replacement facts."
        )
    return PromptAssembly(
        system_prompt=(
            f"{prompt.system_prompt}\n\n"
            "STRUCTURED OUTPUT REPAIR: The previous response failed deterministic "
            "content-v1 validation. Regenerate the complete requested output. "
            "Do not return a patch, explanation, approval, or publishing decision."
            f"{claim_repair}"
            f"{protected_text_repair}"
            f"{safe_copy_mode}"
        ),
        user_prompt=(
            f"{prompt.user_prompt}\n\n"
            "The previous output failed with this safe validation summary:\n"
            f"code={error.code}\nmessage={error!s}\n"
            "Return the complete corrected structured output."
        ),
        metadata={
            **prompt.metadata,
            "repair_attempt": attempt,
            "repair_error_code": error.code,
        },
        context=prompt.context,
    )


def _validation_error(validation: ContentValidationResult) -> ProviderError:
    """Return bounded, safe, multi-issue feedback for the next repair pass."""
    first = validation.issues[0]
    summaries = [f"{issue.field}: {issue.message}" for issue in validation.issues[:5]]
    return ProviderError(
        first.code,
        "Validation issues: " + " | ".join(summaries),
        retryable=first.retryable,
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


async def _generate_content_pack(
    provider: ContentLLMProvider,
    prompt: PromptAssembly,
    *,
    max_output_tokens: int | None,
) -> list[ContentItemVersion]:
    """Call providers with an output cap without breaking older test adapters."""

    method = provider.generate_content_pack
    if max_output_tokens is None:
        return await method(prompt)
    try:
        supports_cap = "max_output_tokens" in inspect.signature(method).parameters
    except (TypeError, ValueError):
        supports_cap = False
    if not supports_cap:
        return await method(prompt)
    return await method(prompt, max_output_tokens=max_output_tokens)


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
    warnings = [code for code in item.warnings if code != "CONTENT_PLATFORM_CONSTRAINT"]
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
        if (
            item.asset_required
            and not asset_ids
            and "CONTENT_ASSET_REQUIRED" not in blockers
        ):
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
    max_output_tokens: int | None = None,
    extra_validator: Callable[[list[ContentItemVersion]], ContentValidationResult]
    | None = None,
    request_validator: Callable[
        [AiContentGenerateRequest, list[ContentItemVersion]], ContentValidationResult
    ]
    | None = None,
    output_normalizer: Callable[[list[ContentItemVersion]], list[ContentItemVersion]]
    | None = None,
    final_output_normalizer: Callable[
        [list[ContentItemVersion]], list[ContentItemVersion]
    ]
    | None = None,
    final_output_repair: Callable[
        [list[ContentItemVersion], ContentValidationResult],
        list[ContentItemVersion],
    ]
    | None = None,
) -> list[ContentItemVersion]:
    """Generate a complete pack with bounded schema repair and safe retry.

    ``extra_validator`` (content-v2) runs after request validation on every
    attempt; its first issue becomes a repairable ProviderError. A v2 caller
    may supply ``request_validator`` when each frozen card has its own CTA or
    media boundary that cannot be represented by one v1 week context.
    ``output_normalizer`` may apply deterministic, grounding-preserving shape
    fixes before server-owned identity and checksums are finalized.
    ``final_output_normalizer`` runs after server-owned identity and checksum
    finalization. It is reserved for contract-specific references that must
    use the final immutable version id (for example v2 generated media).
    """
    _ensure_provider_allowed(breaker)
    current_prompt = prompt
    last_error: ProviderError | None = None
    for attempt in range(1, max_attempts + 1):
        try:
            items = await _generate_content_pack(
                provider,
                current_prompt,
                max_output_tokens=max_output_tokens,
            )
            _validate_pack_shape(items)
            if output_normalizer is not None:
                items = output_normalizer(items)
                _validate_pack_shape(items)
            if request is not None:
                items = _finalize_generated_items(
                    request, items, provider, current_prompt
                )
                if final_output_normalizer is not None:
                    items = final_output_normalizer(items)
                    _validate_pack_shape(items)
            if request is not None:
                validation = (
                    request_validator(request, items)
                    if request_validator is not None
                    else validate_generated_content_pack(
                        request,
                        items,
                        enforce_asset_readiness=False,
                    )
                )
                if (
                    not validation.valid
                    and attempt == max_attempts
                    and final_output_repair is not None
                ):
                    repaired_items = final_output_repair(items, validation)
                    _validate_pack_shape(repaired_items)
                    if final_output_normalizer is not None:
                        repaired_items = final_output_normalizer(repaired_items)
                        _validate_pack_shape(repaired_items)
                    repaired_validation = (
                        request_validator(request, repaired_items)
                        if request_validator is not None
                        else validate_generated_content_pack(
                            request,
                            repaired_items,
                            enforce_asset_readiness=False,
                        )
                    )
                    if repaired_validation.valid:
                        if extra_validator is not None:
                            repaired_extra_validation = extra_validator(repaired_items)
                            if not repaired_extra_validation.valid:
                                raise _validation_error(repaired_extra_validation)
                        logger.warning(
                            "content deterministic_safe_fallback applied after attempt=%d",
                            attempt,
                        )
                        return repaired_items
                    validation = repaired_validation
                if not validation.valid:
                    raise _validation_error(validation)
            if extra_validator is not None:
                extra_validation = extra_validator(items)
                if not extra_validation.valid:
                    raise _validation_error(extra_validation)
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
                current_prompt = _repair_prompt(current_prompt, error, attempt)
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
            "Content provider output remained unsafe after bounded repair: "
            f"{last_error}",
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
                    raise _validation_error(validation)
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
                current_prompt = _repair_prompt(current_prompt, error, attempt)
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
