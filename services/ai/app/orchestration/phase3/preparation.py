"""Immutable input validation and Research-to-Strategy preparation."""

from __future__ import annotations

from error_codes import ERROR_CODES
from strategy_contracts import StrategyGenerateRequest

from app.decisions.errors import DecisionRuleInputError
from app.decisions.service import compute_strategy_decisions
from app.strategy.retrieval_adapter import contract_pack_to_rag

from .contracts import (
    Phase3InputV1,
    PreparedPhase3InputV1,
    ResearchStrategyHandoffV1,
)


class Phase3PreparationError(ValueError):
    """A visible, stable failure before graph execution begins."""

    def __init__(self, code: str, message: str) -> None:
        if code not in ERROR_CODES:
            raise ValueError(f"Unknown Phase 3 error code: {code}")
        self.code = code
        super().__init__(message)


def _require_equal(label: str, expected: object, actual: object) -> None:
    if expected != actual:
        raise Phase3PreparationError(
            "ORCHESTRATION_SCOPE_MISMATCH",
            f"{label} does not match the immutable orchestration start.",
        )


def _validate_snapshots(request: Phase3InputV1) -> None:
    start = request.start
    profile = request.business_profile
    brief = request.strategy_brief
    retrieval = request.retrieval_pack
    research = request.research_pack

    _require_equal("profile business_id", start.business_id, profile.business_id)
    _require_equal("profile version id", start.confirmed_profile_version_id, profile.id)
    _require_equal("profile version", start.confirmed_profile_version, profile.version)
    if not profile.confirmed_by_user_id or not profile.confirmed_at:
        raise Phase3PreparationError(
            "STRATEGY_PROFILE_UNCONFIRMED",
            "Strategy preparation requires a confirmed Business Profile version.",
        )

    _require_equal("brief id", start.strategy_brief_id, brief.id)
    _require_equal("brief strategy id", start.strategy_id, brief.strategy_id)
    _require_equal(
        "brief profile version id",
        start.confirmed_profile_version_id,
        brief.business_profile_version.business_profile_version_id,
    )
    _require_equal(
        "brief profile version",
        start.confirmed_profile_version,
        brief.business_profile_version.version,
    )

    _require_equal("retrieval profile version id", profile.id, retrieval.profile_version_id)
    _require_equal("retrieval brief id", brief.id, retrieval.brief_id)

    _require_equal("research run id", start.run_id, research.run_id)
    _require_equal("research business id", start.business_id, research.business_id)
    _require_equal(
        "research profile version id",
        start.confirmed_profile_version_id,
        research.profile_version_id,
    )
    if research.stop_reason != "sufficient_evidence":
        raise Phase3PreparationError(
            "STRATEGY_KNOWLEDGE_GAP",
            "Strategy preparation stopped because the Research evidence gate was not met.",
        )


def prepare_phase3_input(request: Phase3InputV1) -> PreparedPhase3InputV1:
    """Validate exact immutable refs and build a deterministic Strategy request."""

    _validate_snapshots(request)
    try:
        rag_pack = contract_pack_to_rag(request.retrieval_pack)
        decisions = compute_strategy_decisions(
            business_profile=request.business_profile,
            brief=request.strategy_brief,
            retrieval_pack=rag_pack,
        )
        strategy_request = StrategyGenerateRequest(
            contract_version="strategy-v1",
            strategy_id=request.start.strategy_id,
            business_profile=request.business_profile,
            brief=request.strategy_brief,
            retrieved_knowledge_pack=request.retrieval_pack,
            deterministic_channel_scores=decisions.channel_scorecards,
        )
    except DecisionRuleInputError as exc:
        raise Phase3PreparationError(
            "ORCHESTRATION_VALIDATION_FAILED",
            f"Deterministic Strategy preparation failed for {exc.field}: {exc.message}",
        ) from exc
    except Exception as exc:
        raise Phase3PreparationError(
            "ORCHESTRATION_VALIDATION_FAILED",
            f"Deterministic Strategy preparation failed: {exc}",
        ) from exc

    handoff = ResearchStrategyHandoffV1(
        contract_version="research-strategy-handoff-v1",
        run_id=request.start.run_id,
        business_id=request.start.business_id,
        profile_version_id=request.start.confirmed_profile_version_id,
        strategy_id=request.start.strategy_id,
        strategy_brief_id=request.start.strategy_brief_id,
        research_pack=request.research_pack,
        strategy_request=strategy_request,
    )
    return PreparedPhase3InputV1(
        contract_version="prepared-phase3-input-v1",
        start=request.start,
        handoff=handoff,
    )
