"""Planner-stage assembly and bounded repair orchestration (Content v2).

Issue #187: the planner receives only the approved Strategy v2 handoff, the
cycle editorial settings, and permitted owner inputs; it returns 3-5
high-level post cards. Full-draft generation happens later against a
transactionally frozen snapshot.
"""

from __future__ import annotations

import hashlib
import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from content_v2_contracts import (
    AiContentV2PlanRequest,
    ContentPostPlanDraftV2,
)

from app.content.circuit_breaker import CircuitBreaker
from app.content.planner_prompts import (
    CONTENT_PLAN_SYSTEM_PROMPT,
    build_plan_context,
    build_plan_user_context,
)
from app.content.planner_validators import (
    validate_content_plan_request,
    validate_generated_plan,
)
from app.content.prompt_versions import (
    CONTENT_PLAN_PROMPT_VERSION,
    CONTENT_REFERENCE_PATTERN_VERSION,
)
from app.providers.base import ProviderError
from app.providers.content_provider import ContentLLMProvider

MAX_PLAN_ATTEMPTS = 3
logger = logging.getLogger(__name__)

_REPAIRABLE_PLAN_CODES = {
    "CONTENT_SCHEMA_FAILURE",
    "CONTENT_CHANNEL_MISMATCH",
    "AI_PROVIDER_INVALID_OUTPUT",
}


@dataclass(frozen=True)
class PlanAssembly:
    """A complete planner prompt plus non-sensitive reproducibility metadata."""

    system_prompt: str
    user_prompt: str
    metadata: dict[str, Any]
    context: dict[str, Any]


def _sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _plan_metadata(
    request: AiContentV2PlanRequest,
    user_prompt: str,
    provider_name: str,
    model: str,
) -> dict[str, Any]:
    """Record identities and hashes without copying private grounding values."""
    return {
        "prompt_version": CONTENT_PLAN_PROMPT_VERSION,
        "reference_pattern_version": CONTENT_REFERENCE_PATTERN_VERSION,
        "provider_name": provider_name,
        "model": model,
        "contract_version": request.contract_version,
        "assembled_at": datetime.now(timezone.utc).isoformat(),
        "week_plan_id": request.week_plan_id,
        "business_id": request.business_id,
        "strategy_id": request.strategy_id,
        "strategy_version": request.strategy_version,
        "strategy_decision_id": request.strategy_decision_id,
        "week_number": request.week_number,
        "language_mode": str(
            getattr(request.language_mode, "value", request.language_mode)
        ),
        "input_snapshot_hash": _sha256(user_prompt),
    }


def assemble_plan_prompt(
    request: AiContentV2PlanRequest,
    provider_name: str,
    model: str,
) -> PlanAssembly:
    """Assemble and validate the planner prompt for the requested week."""
    validation = validate_content_plan_request(request)
    if not validation.valid:
        first_issue = validation.issues[0]
        raise ValueError(
            f"{first_issue.code}: {first_issue.field}: {first_issue.message}"
        )
    user_prompt = build_plan_user_context(request)
    return PlanAssembly(
        system_prompt=CONTENT_PLAN_SYSTEM_PROMPT,
        user_prompt=user_prompt,
        metadata=_plan_metadata(request, user_prompt, provider_name, model),
        context=build_plan_context(request),
    )


def _validate_plan_shape(plans: object) -> None:
    if not isinstance(plans, list) or not all(
        isinstance(plan, ContentPostPlanDraftV2) for plan in plans
    ):
        raise ProviderError(
            "CONTENT_SCHEMA_FAILURE",
            "The planner must return a list of ContentPostPlanDraftV2 objects.",
            retryable=False,
        )
    if not 3 <= len(plans) <= 5:
        raise ProviderError(
            "CONTENT_SCHEMA_FAILURE",
            "The planner must return between 3 and 5 post plans.",
            retryable=False,
        )


def _ensure_provider_allowed(breaker: CircuitBreaker | None) -> None:
    if breaker is not None and not breaker.allow():
        raise ProviderError(
            "CONTENT_PROVIDER_FAILURE",
            "Content planner circuit breaker is open; refusing provider call.",
            retryable=True,
        )


def _repair_plan_prompt(
    prompt: PlanAssembly,
    error: ProviderError,
    attempt: int,
) -> PlanAssembly:
    return PlanAssembly(
        system_prompt=(
            f"{prompt.system_prompt}\n\n"
            "STRUCTURED OUTPUT REPAIR: The previous plan response failed "
            "deterministic content-v2 validation. Regenerate the complete "
            "requested plan cards. Do not return a patch, explanation, "
            "approval, or publishing decision."
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


async def plan_content_week_with_repair(
    provider: ContentLLMProvider,
    prompt: PlanAssembly,
    request: AiContentV2PlanRequest,
    breaker: CircuitBreaker | None,
) -> list[ContentPostPlanDraftV2]:
    """Run the planner with bounded retries and structured-output repair."""
    current_prompt = prompt
    for attempt in range(1, MAX_PLAN_ATTEMPTS + 1):
        _ensure_provider_allowed(breaker)
        try:
            plans = await provider.generate_content_plan(current_prompt)
            _validate_plan_shape(plans)
            validation = validate_generated_plan(request, plans)
            if not validation.valid:
                first_issue = validation.issues[0]
                raise ProviderError(
                    first_issue.code,
                    f"{first_issue.field}: {first_issue.message}",
                    retryable=first_issue.retryable,
                )
            if breaker is not None:
                breaker.record_success()
            return plans
        except ProviderError as error:
            if breaker is not None:
                breaker.record_failure()
            if (
                attempt < MAX_PLAN_ATTEMPTS
                and error.code in _REPAIRABLE_PLAN_CODES
            ):
                current_prompt = _repair_plan_prompt(current_prompt, error, attempt)
                continue
            raise
    raise ProviderError(
        "CONTENT_PROVIDER_FAILURE",
        "Planner exceeded the maximum number of attempts.",
        retryable=True,
    )
