"""Durable LangGraph Strategy segment with an owner approval interrupt.

The compiled graph is intentionally not mounted by ``app.main``.  A caller
provides a checkpointer and a Strategy provider, and receives a typed draft
handoff when the graph pauses.  No Nest or Strategy database write happens in
the graph itself.
"""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, AsyncContextManager, Callable, Literal, TypedDict

from langgraph.graph import END, START, StateGraph
from langgraph.types import Command, interrupt
from pydantic import ValidationError

from error_codes import ERROR_CODES
from orchestration_contracts import (
    CampaignOrchestrationResumeV1,
    CampaignOrchestrationResultV1,
    CampaignOrchestrationStartV1,
    CampaignOrchestrationStateV1,
    OrchestrationAuditV1,
    OrchestrationErrorV1,
    OrchestrationImmutableInputRefsV1,
    OrchestrationStrategyStateV1,
    StrategyDecisionBindingV1,
)
from strategy_contracts import StrategyGenerateRequest, StrategyPlan, StrategyValidationResult

from .checksum import strategy_plan_checksum
from .contracts import (
    Phase3InputV1,
    PreparedPhase3InputV1,
    StrategyApprovalInterruptV1,
    StrategyDraftHandoffV1,
    StrategyDraftPersistenceReceiptV1,
    StrategyQualityReviewV1,
)
from .preparation import prepare_phase3_input
from .strategy_segment import (
    DeterministicStrategyQualityReviewer,
    Phase3GenerationError,
    StrategyQualityReviewer,
    StrategySegment,
)


class Phase3GraphState(TypedDict, total=False):
    """All checkpointed values are JSON-compatible model dumps."""

    checkpoint_version: int
    input_snapshot: dict[str, Any]
    orchestration: dict[str, Any]
    research_strategy_handoff: dict[str, Any]
    strategy_request: dict[str, Any]
    plan: dict[str, Any]
    validation: dict[str, Any]
    quality_review: dict[str, Any]
    approval_interrupt: dict[str, Any]
    approval_binding: dict[str, Any]
    replan_instruction: str
    replans_used: int
    phase3_error: dict[str, Any]


class Phase3RunError(RuntimeError):
    """Stable runner error returned before a graph command is sent."""

    def __init__(self, code: str, message: str) -> None:
        if code not in ERROR_CODES:
            raise ValueError(f"Unknown Phase 3 error code: {code}")
        self.code = code
        super().__init__(message)


def _now_iso() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _bump(state: Phase3GraphState, **updates: Any) -> dict[str, Any]:
    result = dict(state)
    result.update(updates)
    result["checkpoint_version"] = int(state.get("checkpoint_version", 0)) + 1
    return result


def _orchestration_model(state: Phase3GraphState) -> CampaignOrchestrationStateV1:
    return CampaignOrchestrationStateV1.model_validate(state["orchestration"])


def _replace_orchestration(
    state: Phase3GraphState,
    *,
    status: str | None = None,
    current_role: str | None | object = ...,
    current_stage: str | None = None,
    strategy: OrchestrationStrategyStateV1 | None = None,
    replans_used: int | None = None,
    summary: str | None = None,
    stable_error: str | None = None,
) -> dict[str, Any]:
    """Update a typed orchestration state while revalidating the contract."""

    current = _orchestration_model(state).model_dump(mode="json")
    if status is not None:
        current["status"] = status
    if current_role is not ...:
        current["current_role"] = current_role
    if current_stage is not None:
        current["current_stage"] = current_stage
    if strategy is not None:
        current["strategy"] = strategy.model_dump(mode="json")
    if replans_used is not None:
        bounds = dict(current["bounds"])
        bounds["replans_used"] = replans_used
        current["bounds"] = bounds

    audit = dict(current["audit"])
    if summary:
        audit["action_summaries"] = [*audit["action_summaries"], summary]
    if stable_error and stable_error not in audit["stable_errors"]:
        audit["stable_errors"] = [*audit["stable_errors"], stable_error]
    audit["updated_at"] = _now_iso()
    current["audit"] = audit
    validated = CampaignOrchestrationStateV1.model_validate(current)
    return validated.model_dump(mode="json")


def _failure_state(
    state: Phase3GraphState,
    *,
    code: str,
    message: str,
    details: dict[str, Any] | None = None,
    retryable: bool = False,
) -> dict[str, Any]:
    if code not in ERROR_CODES:
        code = "ORCHESTRATION_VALIDATION_FAILED"
    orchestration = _replace_orchestration(
        state,
        status="failed",
        current_role=None,
        current_stage="failed",
        summary=message,
        stable_error=code,
    )
    error = OrchestrationErrorV1(
        code=code,
        message=message,
        retryable=retryable,
        details=details or {},
    ).model_dump(mode="json")
    return _bump(state, orchestration=orchestration, phase3_error=error)


def _initial_state(prepared: PreparedPhase3InputV1) -> Phase3GraphState:
    start = prepared.start
    timestamp = _now_iso()
    immutable = OrchestrationImmutableInputRefsV1(
        confirmed_profile_version_id=start.confirmed_profile_version_id,
        confirmed_profile_version=start.confirmed_profile_version,
        confirmed_profile_checksum=start.confirmed_profile_checksum,
        strategy_id=start.strategy_id,
        strategy_brief_id=start.strategy_brief_id,
        requested_week_number=start.requested_week_number,
        week_context_id=start.week_context_id,
        week_context_checksum=start.week_context_checksum,
    )
    orchestration = CampaignOrchestrationStateV1(
        contract_version="orchestration-v1",
        run_id=start.run_id,
        correlation_id=start.correlation_id,
        owner_user_id=start.owner_user_id,
        business_id=start.business_id,
        graph_name=start.graph_name,
        graph_version=start.graph_version,
        status="running",
        current_role="strategy",
        current_stage="strategy",
        feature_cohort=start.feature_cohort,
        immutable_input=immutable,
        research_pack=prepared.handoff.research_pack,
        strategy=OrchestrationStrategyStateV1(
            pending_decision=False,
            validation_valid=None,
        ),
        content={"pending_decision": False},
        bounds=start.bounds,
        audit=OrchestrationAuditV1(
            prompt_versions=[],
            provider_versions=[],
            action_summaries=["Phase 3 immutable Research-to-Strategy handoff prepared."],
            stable_errors=[],
            created_at=timestamp,
            updated_at=timestamp,
        ),
    )
    return Phase3GraphState(
        checkpoint_version=0,
        input_snapshot={"start": start.model_dump(mode="json")},
        orchestration=orchestration.model_dump(mode="json"),
        research_strategy_handoff=prepared.handoff.model_dump(mode="json"),
        strategy_request=prepared.handoff.strategy_request.model_dump(mode="json"),
        replans_used=start.bounds.replans_used,
    )


def build_phase3_graph(
    checkpointer: Any,
    segment: StrategySegment,
    reviewer: StrategyQualityReviewer | None = None,
):
    """Compile the Phase 3 graph with an injected LangGraph checkpointer."""

    quality_reviewer = reviewer or DeterministicStrategyQualityReviewer()

    async def strategy_node(state: Phase3GraphState) -> dict[str, Any]:
        request = StrategyGenerateRequest.model_validate(state["strategy_request"])
        try:
            generated = await segment.generate(
                request,
                repair_instruction=state.get("replan_instruction"),
                replan_attempt=int(state.get("replans_used", 0)),
            )
        except Phase3GenerationError as exc:
            return _failure_state(
                state,
                code=exc.code,
                message=str(exc),
                details=exc.details,
            )

        strategy = OrchestrationStrategyStateV1(
            draft_id=generated.plan.id,
            version_id=None,
            version=generated.plan.version,
            checksum=strategy_plan_checksum(generated.plan),
            validation_valid=generated.validation.valid,
            pending_decision=False,
        )
        orchestration = _replace_orchestration(
            state,
            current_role="strategy",
            current_stage="strategy",
            strategy=strategy,
            summary=(
                f"Strategy generated and validated with {generated.provider_attempts} "
                f"provider attempt(s)."
            ),
        )
        audit = orchestration["audit"]
        audit["provider_versions"] = [
            *audit["provider_versions"],
            generated.provider_name,
        ]
        audit["prompt_versions"] = [
            *audit["prompt_versions"],
            generated.prompt_version,
        ]
        orchestration = CampaignOrchestrationStateV1.model_validate(
            {**orchestration, "audit": audit}
        ).model_dump(mode="json")
        return _bump(
            state,
            orchestration=orchestration,
            plan=generated.plan.model_dump(mode="json"),
            validation=generated.validation.model_dump(mode="json"),
            replan_instruction=None,
        )

    async def review_node(state: Phase3GraphState) -> dict[str, Any]:
        try:
            plan = StrategyPlan.model_validate(state["plan"])
            validation = StrategyValidationResult.model_validate(state["validation"])
            review = await quality_reviewer.review(plan, validation)
        except Exception as exc:
            return _failure_state(
                state,
                code="ORCHESTRATION_VALIDATION_FAILED",
                message=f"Strategy quality review failed: {exc}",
            )

        if review.valid:
            checksum = strategy_plan_checksum(plan)
            interrupt_payload = StrategyApprovalInterruptV1(
                kind="strategy_approval",
                run_id=_orchestration_model(state).run_id,
                business_id=_orchestration_model(state).business_id,
                owner_user_id=_orchestration_model(state).owner_user_id,
                strategy_id=_orchestration_model(state).immutable_input.strategy_id,
                draft_id=plan.id,
                strategy_version=plan.version,
                strategy_checksum=checksum,
                message="Review the immutable Strategy draft and provide an owner decision.",
            )
            strategy = OrchestrationStrategyStateV1(
                draft_id=plan.id,
                version_id=None,
                version=plan.version,
                checksum=checksum,
                validation_valid=True,
                pending_decision=True,
            )
            orchestration = _replace_orchestration(
                state,
                status="awaiting_strategy_approval",
                current_role="strategy",
                current_stage="strategy_approval",
                strategy=strategy,
                summary=review.short_explanation,
            )
            return _bump(
                state,
                orchestration=orchestration,
                quality_review=review.model_dump(mode="json"),
                approval_interrupt=interrupt_payload.model_dump(mode="json"),
            )

        used = int(state.get("replans_used", 0))
        limit = _orchestration_model(state).bounds.replans_limit
        if review.repairable and used < limit:
            next_used = used + 1
            orchestration = _replace_orchestration(
                state,
                current_role="strategy",
                current_stage="strategy",
                replans_used=next_used,
                summary=f"Targeted Strategy replan {next_used}/{limit} requested: {review.short_explanation}",
            )
            return _bump(
                state,
                orchestration=orchestration,
                quality_review=review.model_dump(mode="json"),
                replans_used=next_used,
                replan_instruction=review.short_explanation,
            )

        if review.repairable and used >= limit:
            return _failure_state(
                state,
                code="ORCHESTRATION_BUDGET_EXCEEDED",
                message="Strategy targeted replan limit exhausted; the last artifact was not approved.",
                details={"replans_used": used, "replans_limit": limit},
            )
        code = review.issue_code if review.issue_code in ERROR_CODES else "ORCHESTRATION_VALIDATION_FAILED"
        return _failure_state(
            state,
            code=code,
            message=review.short_explanation,
            details={
                "field": review.field,
                "recommended_node": review.recommended_node,
            },
        )

    def await_approval_node(state: Phase3GraphState) -> dict[str, Any]:
        payload = state.get("approval_interrupt")
        if not payload:
            return _failure_state(
                state,
                code="ORCHESTRATION_CHECKPOINT_FAILURE",
                message="Strategy approval payload was missing at the interrupt boundary.",
            )
        decision = interrupt(payload)
        if isinstance(decision, dict) and decision.get("kind") == "strategy_draft_persisted":
            approval_payload = StrategyApprovalInterruptV1.model_validate(payload)
            if not approval_payload.persistence_required:
                return _failure_state(
                    state,
                    code="ORCHESTRATION_STALE_RESUME",
                    message="The Strategy persistence receipt was already attached.",
                )
            try:
                receipt = StrategyDraftPersistenceReceiptV1.model_validate(decision)
            except ValidationError as exc:
                return _failure_state(
                    state,
                    code="ORCHESTRATION_VALIDATION_FAILED",
                    message=f"Persisted Strategy receipt failed contract validation: {exc}",
                )
            orchestration_model = _orchestration_model(state)
            if (
                receipt.run_id != orchestration_model.run_id
                or receipt.business_id != orchestration_model.business_id
                or receipt.strategy_id != orchestration_model.immutable_input.strategy_id
                or receipt.draft_id != orchestration_model.strategy.draft_id
                or receipt.strategy_checksum != orchestration_model.strategy.checksum
                or receipt.strategy_version != orchestration_model.strategy.version
            ):
                return _failure_state(
                    state,
                    code="ORCHESTRATION_STALE_RESUME",
                    message="Persisted Strategy receipt does not match the paused draft.",
                )
            strategy = OrchestrationStrategyStateV1(
                draft_id=orchestration_model.strategy.draft_id,
                version_id=receipt.strategy_version_id,
                version=receipt.strategy_version,
                checksum=receipt.strategy_checksum,
                validation_valid=True,
                pending_decision=True,
            )
            updated_payload = approval_payload.model_copy(
                update={"persistence_required": False}
            )
            orchestration = _replace_orchestration(
                state,
                status="awaiting_strategy_approval",
                current_role="strategy",
                current_stage="strategy_approval",
                strategy=strategy,
                summary="Nest persisted the immutable Strategy version; awaiting the owner decision.",
            )
            return _bump(
                state,
                orchestration=orchestration,
                approval_interrupt=updated_payload.model_dump(mode="json"),
            )
        try:
            binding = StrategyDecisionBindingV1.model_validate(decision)
        except ValidationError as exc:
            return _failure_state(
                state,
                code="ORCHESTRATION_VALIDATION_FAILED",
                message=f"Owner Strategy decision failed contract validation: {exc}",
            )

        orchestration_model = _orchestration_model(state)
        if (
            binding.run_id != orchestration_model.run_id
            or binding.business_id != orchestration_model.business_id
            or binding.strategy_id != orchestration_model.immutable_input.strategy_id
            or binding.strategy_checksum != orchestration_model.strategy.checksum
            or binding.strategy_version != orchestration_model.strategy.version
            or binding.strategy_version_id != orchestration_model.strategy.version_id
            or binding.decided_by_user_id != orchestration_model.owner_user_id
        ):
            return _failure_state(
                state,
                code="ORCHESTRATION_STALE_RESUME",
                message="Owner decision does not match the paused immutable Strategy draft.",
            )

        strategy = OrchestrationStrategyStateV1(
            draft_id=orchestration_model.strategy.draft_id,
            version_id=binding.strategy_version_id,
            version=binding.strategy_version,
            checksum=binding.strategy_checksum,
            validation_valid=True,
            pending_decision=False,
            decision_binding=binding,
        )
        orchestration = _replace_orchestration(
            state,
            status="running",
            current_role="strategy",
            current_stage="strategy_approval",
            strategy=strategy,
            summary=f"Owner Strategy decision recorded: {binding.decision}.",
        )
        return _bump(
            state,
            orchestration=orchestration,
            approval_binding=binding.model_dump(mode="json"),
        )

    def terminal_node(_state: Phase3GraphState) -> dict[str, Any]:
        return {}

    def route_after_strategy(state: Phase3GraphState) -> Literal["review", "terminal"]:
        return "terminal" if state.get("phase3_error") else "review"

    def route_after_review(
        state: Phase3GraphState,
    ) -> Literal["replan", "await_approval", "terminal"]:
        if state.get("phase3_error"):
            return "terminal"
        review = StrategyQualityReviewV1.model_validate(state["quality_review"])
        if review.valid:
            return "await_approval"
        return "replan" if review.repairable else "terminal"

    def route_after_approval(
        state: Phase3GraphState,
    ) -> Literal["await_approval", "terminal"]:
        if state.get("phase3_error"):
            return "terminal"
        # A persistence receipt is accepted first, then the graph pauses a
        # second time for the actual owner decision.  Once a binding exists,
        # this segment is complete and Phase 4 can continue from the saved
        # state.
        return "await_approval" if not state.get("approval_binding") else "terminal"

    builder = StateGraph(Phase3GraphState)
    builder.add_node("strategy", strategy_node)
    builder.add_node("review", review_node)
    builder.add_node("await_approval", await_approval_node)
    builder.add_node("terminal", terminal_node)
    builder.add_edge(START, "strategy")
    builder.add_conditional_edges(
        "strategy",
        route_after_strategy,
        {"review": "review", "terminal": "terminal"},
    )
    builder.add_conditional_edges(
        "review",
        route_after_review,
        {
            "replan": "strategy",
            "await_approval": "await_approval",
            "terminal": "terminal",
        },
    )
    builder.add_conditional_edges(
        "await_approval",
        route_after_approval,
        {"await_approval": "await_approval", "terminal": "terminal"},
    )
    builder.add_edge("terminal", END)
    return builder.compile(checkpointer=checkpointer)


@dataclass(frozen=True)
class Phase3StartResult:
    result: CampaignOrchestrationResultV1
    approval_interrupt: StrategyApprovalInterruptV1 | None
    draft_handoff: StrategyDraftHandoffV1 | None


@dataclass(frozen=True)
class Phase3ResumeResult:
    result: CampaignOrchestrationResultV1


class Phase3Runner:
    """Start/resume facade that validates scope before issuing graph commands.

    Tests use the default process-local lock. Production callers should inject
    the same PostgreSQL advisory-lock context used by the Phase 0 durability
    probe so duplicate delivery is serialized across FastAPI processes.
    """

    def __init__(
        self,
        graph: Any,
        *,
        lock_factory: Callable[[str], AsyncContextManager[None]] | None = None,
    ) -> None:
        self.graph = graph
        self._locks: dict[str, asyncio.Lock] = {}
        self._lock_factory = lock_factory

    @asynccontextmanager
    async def _acquire(self, run_id: str):
        if self._lock_factory is not None:
            async with self._lock_factory(run_id):
                yield
            return
        lock = self._locks.setdefault(run_id, asyncio.Lock())
        async with lock:
            yield

    @staticmethod
    def _config(run_id: str) -> dict[str, Any]:
        return {"configurable": {"thread_id": run_id}}

    async def start(self, request: Phase3InputV1 | PreparedPhase3InputV1) -> Phase3StartResult:
        prepared = (
            request
            if isinstance(request, PreparedPhase3InputV1)
            else prepare_phase3_input(request)
        )
        run_id = prepared.start.run_id
        async with self._acquire(run_id):
            config = self._config(run_id)
            existing = await self.graph.aget_state(config)
            if existing is not None and (
                existing.values or existing.next or existing.interrupts
            ):
                raise Phase3RunError(
                    "ORCHESTRATION_DUPLICATE_START",
                    "An orchestration checkpoint already exists for this run.",
                )
            try:
                await self.graph.ainvoke(_initial_state(prepared), config)
                snapshot = await self.graph.aget_state(config)
            except Exception as exc:
                raise Phase3RunError(
                    "ORCHESTRATION_CHECKPOINT_FAILURE",
                    f"Phase 3 graph start failed: {exc}",
                ) from exc
            return self._start_result(snapshot, run_id)

    def _start_result(self, snapshot: Any, run_id: str) -> Phase3StartResult:
        result = self._result_from_snapshot(snapshot, run_id)
        approval: StrategyApprovalInterruptV1 | None = None
        if snapshot.interrupts:
            approval = StrategyApprovalInterruptV1.model_validate(
                snapshot.interrupts[0].value
            )
        elif snapshot.values.get("approval_interrupt"):
            approval = StrategyApprovalInterruptV1.model_validate(
                snapshot.values["approval_interrupt"]
            )

        handoff = None
        if approval is not None and snapshot.values.get("plan"):
            handoff = self._draft_handoff(snapshot.values)
        return Phase3StartResult(
            result=result,
            approval_interrupt=approval,
            draft_handoff=handoff,
        )

    async def resume(self, request: CampaignOrchestrationResumeV1) -> Phase3ResumeResult:
        run_id = request.run_id
        async with self._acquire(run_id):
            config = self._config(run_id)
            snapshot = await self.graph.aget_state(config)
            if snapshot is None or not snapshot.next or not snapshot.interrupts:
                raise Phase3RunError(
                    "ORCHESTRATION_STALE_RESUME",
                    "The orchestration is not paused at a resumable Strategy approval.",
                )
            values = snapshot.values
            self._validate_resume_scope(request, values)
            try:
                await self.graph.ainvoke(
                    Command(
                        resume=request.decision_binding.model_dump(mode="json")
                    ),
                    config,
                )
                updated = await self.graph.aget_state(config)
            except Phase3RunError:
                raise
            except Exception as exc:
                raise Phase3RunError(
                    "ORCHESTRATION_CHECKPOINT_FAILURE",
                    f"Phase 3 graph resume failed: {exc}",
                ) from exc
            if updated.interrupts:
                raise Phase3RunError(
                    "ORCHESTRATION_CHECKPOINT_FAILURE",
                    "Phase 3 resume unexpectedly paused again.",
                )
            return Phase3ResumeResult(self._result_from_snapshot(updated, run_id))

    async def attach_persisted_draft(
        self,
        receipt: StrategyDraftPersistenceReceiptV1,
    ) -> StrategyApprovalInterruptV1:
        """Bind Nest's immutable Strategy version before owner approval.

        The first graph interrupt is intentionally a persistence handoff.  It
        prevents FastAPI from guessing a domain version ID while still making
        the later owner decision bind to the exact persisted version.
        """

        async with self._acquire(receipt.run_id):
            config = self._config(receipt.run_id)
            snapshot = await self.graph.aget_state(config)
            if snapshot is None or not snapshot.next or not snapshot.interrupts:
                raise Phase3RunError(
                    "ORCHESTRATION_STALE_RESUME",
                    "The orchestration is not paused for a Strategy persistence receipt.",
                )
            values = snapshot.values
            orchestration = CampaignOrchestrationStateV1.model_validate(
                values["orchestration"]
            )
            payload = StrategyApprovalInterruptV1.model_validate(
                snapshot.interrupts[0].value
            )
            if not payload.persistence_required:
                raise Phase3RunError(
                    "ORCHESTRATION_STALE_RESUME",
                    "The Strategy persistence receipt was already attached.",
                )
            if (
                receipt.run_id != orchestration.run_id
                or receipt.business_id != orchestration.business_id
                or receipt.strategy_id != orchestration.immutable_input.strategy_id
                or receipt.draft_id != orchestration.strategy.draft_id
                or receipt.strategy_checksum != orchestration.strategy.checksum
                or receipt.strategy_version != orchestration.strategy.version
            ):
                raise Phase3RunError(
                    "ORCHESTRATION_STALE_RESUME",
                    "Persisted Strategy receipt does not match the paused draft.",
                )
            try:
                await self.graph.ainvoke(
                    Command(resume=receipt.model_dump(mode="json")),
                    config,
                )
                updated = await self.graph.aget_state(config)
            except Exception as exc:
                raise Phase3RunError(
                    "ORCHESTRATION_CHECKPOINT_FAILURE",
                    f"Strategy persistence receipt could not be checkpointed: {exc}",
                ) from exc
            if not updated.interrupts:
                raise Phase3RunError(
                    "ORCHESTRATION_CHECKPOINT_FAILURE",
                    "Strategy persistence receipt did not leave an owner approval interrupt.",
                )
            return StrategyApprovalInterruptV1.model_validate(
                updated.interrupts[0].value
            )

    @staticmethod
    def _validate_resume_scope(
        request: CampaignOrchestrationResumeV1,
        values: dict[str, Any],
    ) -> None:
        try:
            orchestration = CampaignOrchestrationStateV1.model_validate(
                values["orchestration"]
            )
            start = CampaignOrchestrationStartV1.model_validate(
                values["input_snapshot"]["start"]
            )
            binding = request.decision_binding
        except (KeyError, ValidationError) as exc:
            raise Phase3RunError(
                "ORCHESTRATION_CHECKPOINT_FAILURE",
                f"Paused Phase 3 state is invalid: {exc}",
            ) from exc

        if not isinstance(binding, StrategyDecisionBindingV1):
            raise Phase3RunError(
                "ORCHESTRATION_SCOPE_MISMATCH",
                "A Strategy approval binding is required for this checkpoint.",
            )
        if (
            request.checkpoint_thread_id != request.run_id
            or request.run_id != orchestration.run_id
            or request.business_id != orchestration.business_id
            or request.owner_user_id != orchestration.owner_user_id
            or request.correlation_id != start.correlation_id
            or request.idempotency_key != start.idempotency_key
        ):
            raise Phase3RunError(
                "ORCHESTRATION_SCOPE_MISMATCH",
                "Resume request does not match the paused run owner or scope.",
            )

        strategy = orchestration.strategy
        if (
            binding.run_id != orchestration.run_id
            or binding.business_id != orchestration.business_id
            or binding.strategy_id != orchestration.immutable_input.strategy_id
            or binding.strategy_checksum != strategy.checksum
            or binding.strategy_version != strategy.version
            or binding.strategy_version_id != strategy.version_id
            or binding.decided_by_user_id != orchestration.owner_user_id
        ):
            raise Phase3RunError(
                "ORCHESTRATION_STALE_RESUME",
                "Resume binding is stale or belongs to another Strategy artifact/owner.",
            )

    @staticmethod
    def _result_from_snapshot(snapshot: Any, run_id: str) -> CampaignOrchestrationResultV1:
        values = snapshot.values
        state = CampaignOrchestrationStateV1.model_validate(values["orchestration"])
        raw_error = values.get("phase3_error")
        error = OrchestrationErrorV1.model_validate(raw_error) if raw_error else None
        return CampaignOrchestrationResultV1(
            contract_version="orchestration-v1",
            run_id=run_id,
            status=state.status,
            checkpoint_thread_id=run_id,
            checkpoint_version=int(values.get("checkpoint_version", 0)),
            state=state,
            error=error,
        )

    @staticmethod
    def _draft_handoff(values: dict[str, Any]) -> StrategyDraftHandoffV1:
        state = CampaignOrchestrationStateV1.model_validate(values["orchestration"])
        start = CampaignOrchestrationStartV1.model_validate(values["input_snapshot"]["start"])
        plan = StrategyPlan.model_validate(values["plan"])
        validation = StrategyValidationResult.model_validate(values["validation"])
        review = StrategyQualityReviewV1.model_validate(values["quality_review"])
        return StrategyDraftHandoffV1(
            contract_version="strategy-draft-handoff-v1",
            run_id=state.run_id,
            business_id=state.business_id,
            owner_user_id=state.owner_user_id,
            strategy_id=state.immutable_input.strategy_id,
            strategy_brief_id=state.immutable_input.strategy_brief_id,
            profile_version_id=state.immutable_input.confirmed_profile_version_id,
            draft_id=plan.id,
            strategy_version=plan.version,
            strategy_checksum=state.strategy.checksum or strategy_plan_checksum(plan),
            plan=plan,
            validation=validation,
            quality_review=review,
            research_pack=state.research_pack,  # type: ignore[arg-type]
            immutable_input_refs=start.model_dump(mode="json"),
        )
