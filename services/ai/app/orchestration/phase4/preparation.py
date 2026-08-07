"""Immutable Strategy-approved input preparation for the Phase 4 graph."""

from __future__ import annotations

from error_codes import ERROR_CODES
from pydantic import ValidationError

from app.content.validators import validate_content_generation_request
from app.orchestration.phase3.checksum import strategy_plan_checksum

from .contracts import (
    Phase4InputV1,
    PreparedPhase4InputV1,
    StrategyContentHandoffV1,
)


class Phase4PreparationError(ValueError):
    """A visible, stable failure before Content provider execution."""

    def __init__(self, code: str, message: str) -> None:
        if code not in ERROR_CODES:
            raise ValueError(f"Unknown Phase 4 error code: {code}")
        self.code = code
        super().__init__(message)


def _require_equal(label: str, expected: object, actual: object) -> None:
    if expected != actual:
        raise Phase4PreparationError(
            "ORCHESTRATION_SCOPE_MISMATCH",
            f"{label} does not match the immutable orchestration start.",
        )


def _validate_approved_strategy(request: Phase4InputV1) -> None:
    start = request.start
    binding = request.strategy_decision
    content = request.content_request
    plan = content.strategy_plan

    if binding.decision != "approved":
        raise Phase4PreparationError(
            "CONTENT_STRATEGY_NOT_APPROVED",
            "Content generation requires an explicitly approved Strategy decision.",
        )

    _require_equal("Strategy decision run id", start.run_id, binding.run_id)
    _require_equal("Strategy decision business id", start.business_id, binding.business_id)
    _require_equal("Strategy decision owner", start.owner_user_id, binding.decided_by_user_id)
    _require_equal("Strategy id", start.strategy_id, binding.strategy_id)
    _require_equal("Content request business id", start.business_id, content.business_id)
    _require_equal("Content request strategy id", start.strategy_id, content.strategy_id)
    _require_equal("Strategy plan id", binding.strategy_id, plan.strategy_id)
    _require_equal("Strategy plan version", binding.strategy_version, plan.version)
    _require_equal("Strategy decision id", binding.decision_id, content.strategy_decision_id)

    if strategy_plan_checksum(plan) != binding.strategy_checksum:
        raise Phase4PreparationError(
            "CONTENT_VERSION_CONFLICT",
            "Content generation requires the exact approved Strategy checksum.",
        )

    _require_equal("Content profile business id", start.business_id, content.business_profile.business_id)
    _require_equal(
        "Content profile version id",
        start.confirmed_profile_version_id,
        content.business_profile.id,
    )
    _require_equal(
        "Content profile version",
        start.confirmed_profile_version,
        content.business_profile.version,
    )
    _require_equal("Content week context id", start.week_context_id, content.week_context.id)
    _require_equal("Content week number", start.requested_week_number, content.week_context.week_number)


def prepare_phase4_input(request: Phase4InputV1) -> PreparedPhase4InputV1:
    """Validate exact Strategy approval and build the Content handoff."""

    _validate_approved_strategy(request)
    validation = validate_content_generation_request(request.content_request)
    if not validation.valid:
        issue = validation.issues[0]
        code = issue.code if issue.code in ERROR_CODES else "ORCHESTRATION_VALIDATION_FAILED"
        raise Phase4PreparationError(code, f"{issue.field}: {issue.message}")

    handoff = StrategyContentHandoffV1(
        contract_version="strategy-content-handoff-v1",
        run_id=request.start.run_id,
        business_id=request.start.business_id,
        strategy_id=request.start.strategy_id,
        strategy_version=request.content_request.strategy_version,
        strategy_decision=request.strategy_decision,
        content_request=request.content_request,
    )
    return PreparedPhase4InputV1(
        contract_version="prepared-phase4-input-v1",
        start=request.start,
        handoff=handoff,
    )


def validate_prepared_phase4_input(
    prepared: PreparedPhase4InputV1,
) -> PreparedPhase4InputV1:
    """Rebuild and compare a prepared handoff before graph execution."""

    try:
        raw = Phase4InputV1(
            contract_version="phase4-input-v1",
            start=prepared.start,
            strategy_decision=prepared.handoff.strategy_decision,
            content_request=prepared.handoff.content_request,
        )
    except ValidationError as exc:
        raise Phase4PreparationError(
            "ORCHESTRATION_SCOPE_MISMATCH",
            "Prepared Phase 4 handoff contains an invalid nested Content request.",
        ) from exc
    canonical = prepare_phase4_input(raw)
    if canonical.model_dump(mode="json") != prepared.model_dump(mode="json"):
        raise Phase4PreparationError(
            "ORCHESTRATION_SCOPE_MISMATCH",
            "Prepared Phase 4 handoff does not match the immutable Strategy approval or Content request.",
        )
    return canonical
