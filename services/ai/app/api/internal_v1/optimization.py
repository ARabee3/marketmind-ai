"""Strict internal Optimization Agent route."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import TypeAdapter, ValidationError

from performance_contracts import (
    OPTIMIZATION_REQUIRED_SNAPSHOT_COUNT,
    OptimizationAgentResultV1,
    OptimizationGenerationRequestV1,
)

from app.core.config import Settings, get_settings
from app.optimization.providers import (
    OptimizationProvider,
    create_optimization_provider,
)
from app.providers.base import ProviderError

router = APIRouter(
    prefix="/internal/v1/ai/optimization",
    tags=["internal-ai-optimization"],
)


def get_optimization_provider(
    settings: Settings = Depends(get_settings),
) -> OptimizationProvider:
    return create_optimization_provider(settings)


def _validate_provider_result(
    raw_result: object,
    request: OptimizationGenerationRequestV1,
) -> OptimizationAgentResultV1:
    try:
        parsed = TypeAdapter(OptimizationAgentResultV1).validate_python(
            raw_result.model_dump(mode="json")
            if hasattr(raw_result, "model_dump")
            else raw_result
        )
    except ValidationError as error:
        raise ProviderError(
            "OPTIMIZATION_PROVIDER_INVALID_OUTPUT",
            "Optimization provider output failed optimization-v1 validation.",
            retryable=False,
        ) from error

    if parsed.generation_fingerprint != request.generation_fingerprint:
        raise ProviderError(
            "OPTIMIZATION_IDENTITY_CONFLICT",
            "Optimization provider changed the generation identity.",
            retryable=False,
        )
    if parsed.outcome == "recommendation":
        expected_ids = sorted(str(item.snapshot_id) for item in request.evidence)
        returned_ids = sorted(str(item) for item in parsed.evidence_snapshot_ids)
        if expected_ids != returned_ids:
            raise ProviderError(
                "OPTIMIZATION_IDENTITY_CONFLICT",
                "Optimization provider did not cite the exact evidence set.",
                retryable=False,
            )
        if parsed.change_kind not in request.allowed_change_kinds:
            raise ProviderError(
                "OPTIMIZATION_PROVIDER_INVALID_OUTPUT",
                "Optimization provider requested a disallowed change kind.",
                retryable=False,
            )
    return parsed


@router.post("/propose")
async def propose_optimization(
    request: OptimizationGenerationRequestV1,
    provider: OptimizationProvider = Depends(get_optimization_provider),
) -> dict:
    if len(request.evidence) < OPTIMIZATION_REQUIRED_SNAPSHOT_COUNT:
        raise HTTPException(
            status_code=422,
            detail={
                "error_type": "OPTIMIZATION_BASELINE_INSUFFICIENT",
                "message": "At least three comparable seven-day snapshots are required.",
                "retryable": False,
            },
        )
    result: OptimizationAgentResultV1 | None = None
    last_error: ProviderError | None = None
    # A provider schema repair is deliberately bounded and reuses the exact
    # request/fingerprint. It cannot change the evidence identity or widen the
    # allowed change kinds.
    for _attempt in range(2):
        try:
            raw_result = await provider.generate(request)
            result = _validate_provider_result(raw_result, request)
            break
        except ProviderError as error:
            last_error = error
            if error.code not in {
                "OPTIMIZATION_PROVIDER_INVALID_OUTPUT",
                "OPTIMIZATION_SCHEMA_FAILURE",
            }:
                break
    if result is None:
        error = last_error or ProviderError(
            "OPTIMIZATION_PROVIDER_FAILURE",
            "Optimization provider did not return a result.",
            retryable=True,
        )
        raise HTTPException(
            status_code=503 if error.retryable else 422,
            detail={
                "error_type": error.code,
                "message": str(error),
                "retryable": error.retryable,
            },
        ) from error
    return result.model_dump(mode="json")
