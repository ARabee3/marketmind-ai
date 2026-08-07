"""Durable LangGraph Content segment after an approved Strategy decision.

The graph is intentionally isolated from ``app.main`` and the existing Content
routes. It returns a typed draft handoff for Nest persistence, then pauses for
one exact immutable Content-item decision. It never writes domain rows or
creates publication candidates.
"""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, AsyncContextManager, Callable, Literal, TypedDict

from error_codes import ERROR_CODES
from content_contracts import (
    AiContentGenerateRequest,
    ContentItemVersion,
    ContentPack,
    ContentValidationResult,
)
from langgraph.graph import END, START, StateGraph
from langgraph.types import Command, interrupt
from orchestration_contracts import (
    CampaignOrchestrationResumeV1,
    CampaignOrchestrationResultV1,
    CampaignOrchestrationStartV1,
    CampaignOrchestrationStateV1,
    ContentDecisionBindingV1,
    OrchestrationAuditV1,
    OrchestrationContentStateV1,
    OrchestrationErrorV1,
    OrchestrationImmutableInputRefsV1,
    OrchestrationStrategyStateV1,
    StrategyDecisionBindingV1,
)
from pydantic import ValidationError

from .content_segment import (
    ContentQualityReviewer,
    ContentSegment,
    Phase4GenerationError,
)
from .contracts import (
    ContentApprovalInterruptV1,
    ContentDraftHandoffV1,
    ContentPackPersistenceReceiptV1,
    ContentQualityReviewV1,
    Phase4InputV1,
    PreparedPhase4InputV1,
)
from .preparation import (
    Phase4PreparationError,
    prepare_phase4_input,
    validate_prepared_phase4_input,
)


class Phase4GraphState(TypedDict, total=False):
    """Checkpointed Phase 4 values; all entries are JSON-compatible dumps."""

    checkpoint_version: int
    input_snapshot: dict[str, Any]
    orchestration: dict[str, Any]
    strategy_decision: dict[str, Any]
    content_request: dict[str, Any]
    content_pack: dict[str, Any]
    item_versions: list[dict[str, Any]]
    validation: dict[str, Any]
    quality_review: dict[str, Any]
    approval_interrupt: dict[str, Any]
    approval_binding: dict[str, Any]
    replan_instruction: str
    replans_used: int
    token_budget_used: int
    cost_budget_used_usd: float
    resume_idempotency_key: str
    phase4_error: dict[str, Any]


class Phase4RunError(RuntimeError):
    """Stable runner error returned before a graph command is sent."""

    def __init__(self, code: str, message: str) -> None:
        if code not in ERROR_CODES:
            raise ValueError(f"Unknown Phase 4 error code: {code}")
        self.code = code
        super().__init__(message)


def _now_iso() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _bump(state: Phase4GraphState, **updates: Any) -> dict[str, Any]:
    result = dict(state)
    result.update(updates)
    result["checkpoint_version"] = int(state.get("checkpoint_version", 0)) + 1
    return result


def _orchestration_model(state: Phase4GraphState) -> CampaignOrchestrationStateV1:
    return CampaignOrchestrationStateV1.model_validate(state["orchestration"])


def _replace_orchestration(
    state: Phase4GraphState,
    *,
    status: str | None = None,
    current_role: str | None | object = ...,
    current_stage: str | None = None,
    content: OrchestrationContentStateV1 | None = None,
    replans_used: int | None = None,
    summary: str | None = None,
    stable_error: str | None = None,
) -> dict[str, Any]:
    current = _orchestration_model(state).model_dump(mode="json")
    if status is not None:
        current["status"] = status
    if current_role is not ...:
        current["current_role"] = current_role
    if current_stage is not None:
        current["current_stage"] = current_stage
    if content is not None:
        current["content"] = content.model_dump(mode="json")
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
    return CampaignOrchestrationStateV1.model_validate(current).model_dump(mode="json")


def _failure_state(
    state: Phase4GraphState,
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
    return _bump(state, orchestration=orchestration, phase4_error=error)


def _initial_state(prepared: PreparedPhase4InputV1) -> Phase4GraphState:
    start = prepared.start
    binding = prepared.handoff.strategy_decision
    request = prepared.handoff.content_request
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
        current_role="content",
        current_stage="content",
        feature_cohort=start.feature_cohort,
        immutable_input=immutable,
        research_pack=None,
        strategy=OrchestrationStrategyStateV1(
            draft_id=None,
            version_id=binding.strategy_version_id,
            version=binding.strategy_version,
            checksum=binding.strategy_checksum,
            validation_valid=True,
            pending_decision=False,
            decision_binding=binding,
        ),
        content=OrchestrationContentStateV1(
            cycle_id=request.week_context.content_cycle_id,
            pending_decision=False,
            validation_valid=None,
        ),
        bounds=start.bounds,
        audit=OrchestrationAuditV1(
            prompt_versions=[],
            provider_versions=[],
            action_summaries=[
                "Phase 4 exact approved Strategy-to-Content handoff prepared."
            ],
            stable_errors=[],
            created_at=timestamp,
            updated_at=timestamp,
        ),
    )
    return Phase4GraphState(
        checkpoint_version=0,
        input_snapshot={"start": start.model_dump(mode="json")},
        orchestration=orchestration.model_dump(mode="json"),
        strategy_decision=binding.model_dump(mode="json"),
        content_request=request.model_dump(mode="json"),
        replans_used=start.bounds.replans_used,
    )


def build_phase4_graph(
    checkpointer: Any,
    segment: ContentSegment,
    reviewer: ContentQualityReviewer | None = None,
):
    """Compile the isolated Content graph with an injected checkpointer."""

    quality_reviewer = reviewer or ContentQualityReviewer()

    async def content_node(state: Phase4GraphState) -> dict[str, Any]:
        request = AiContentGenerateRequest.model_validate(state["content_request"])
        orchestration = _orchestration_model(state)
        try:
            generated = await segment.generate(
                request,
                repair_instruction=state.get("replan_instruction"),
                replan_attempt=int(state.get("replans_used", 0)),
                deadline_at=orchestration.bounds.deadline_at,
                token_budget=orchestration.bounds.token_budget,
                cost_budget_usd=orchestration.bounds.cost_budget_usd,
                token_budget_used=int(state.get("token_budget_used", 0)),
                cost_budget_used_usd=float(state.get("cost_budget_used_usd", 0.0)),
            )
        except Phase4GenerationError as exc:
            return _failure_state(
                state,
                code=exc.code,
                message=str(exc),
                details=exc.details,
            )

        content = OrchestrationContentStateV1(
            cycle_id=generated.pack.content_cycle_id,
            pack_id=generated.pack.id,
            item_id=generated.item_versions[0].content_item_id,
            item_version_id=generated.item_versions[0].id,
            item_version=generated.item_versions[0].version,
            checksum=generated.item_versions[0].version_checksum,
            validation_valid=generated.validation.valid,
            pending_decision=False,
        )
        orchestration = _replace_orchestration(
            state,
            status="running",
            current_role="content",
            current_stage="content",
            content=content,
            summary=(
                f"Content generated and validated with {len(generated.item_versions)} "
                "draft item(s)."
            ),
            replans_used=int(state.get("replans_used", 0)),
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
        token_budget_used = int(state.get("token_budget_used", 0)) + generated.estimated_token_usage
        cost_budget_used_usd = float(state.get("cost_budget_used_usd", 0.0)) + generated.estimated_cost_usd
        return _bump(
            state,
            orchestration=orchestration,
            content_pack=generated.pack.model_dump(mode="json"),
            item_versions=[item.model_dump(mode="json") for item in generated.item_versions],
            validation=generated.validation.model_dump(mode="json"),
            replan_instruction=None,
            token_budget_used=token_budget_used,
            cost_budget_used_usd=cost_budget_used_usd,
        )

    async def review_node(state: Phase4GraphState) -> dict[str, Any]:
        try:
            pack = ContentPack.model_validate(state["content_pack"])
            items = [
                ContentItemVersion.model_validate(item)
                for item in state["item_versions"]
            ]
            validation = ContentValidationResult.model_validate(state["validation"])
            review = await quality_reviewer.review(items, validation)
        except Exception as exc:
            return _failure_state(
                state,
                code="ORCHESTRATION_VALIDATION_FAILED",
                message=f"Content quality review failed: {exc}",
            )

        if review.valid:
            item = items[0]
            interrupt_payload = ContentApprovalInterruptV1(
                kind="content_approval",
                run_id=_orchestration_model(state).run_id,
                business_id=_orchestration_model(state).business_id,
                owner_user_id=_orchestration_model(state).owner_user_id,
                strategy_id=_orchestration_model(state).immutable_input.strategy_id,
                content_cycle_id=pack.content_cycle_id,
                content_pack_id=pack.id,
                content_item_id=item.content_item_id,
                content_item_version_id=item.id,
                content_item_version=item.version,
                content_item_version_checksum=item.version_checksum,
                message=(
                    "Persist the immutable Week-1 Content draft, then provide the "
                    "owner decision for this exact item version."
                ),
            )
            current = _orchestration_model(state).content
            content = current.model_copy(
                update={
                    "cycle_id": pack.content_cycle_id,
                    "pack_id": pack.id,
                    "item_id": item.content_item_id,
                    "item_version_id": item.id,
                    "item_version": item.version,
                    "checksum": item.version_checksum,
                    "validation_valid": True,
                    "pending_decision": True,
                }
            )
            orchestration = _replace_orchestration(
                state,
                status="awaiting_content_approval",
                current_role="content",
                current_stage="content_approval",
                content=content,
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
                status="running",
                current_role="content",
                current_stage="content",
                replans_used=next_used,
                summary=(
                    f"Targeted Content replan {next_used}/{limit} requested: "
                    f"{review.short_explanation}"
                ),
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
                message="Content targeted replan limit exhausted; the draft was not approved.",
                details={"replans_used": used, "replans_limit": limit},
            )
        code = (
            review.issue_code
            if review.issue_code in ERROR_CODES
            else "ORCHESTRATION_VALIDATION_FAILED"
        )
        return _failure_state(
            state,
            code=code,
            message=review.short_explanation,
            details={"field": review.field},
        )

    def await_approval_node(state: Phase4GraphState) -> dict[str, Any]:
        payload = state.get("approval_interrupt")
        if not payload:
            return _failure_state(
                state,
                code="ORCHESTRATION_CHECKPOINT_FAILURE",
                message="Content approval payload was missing at the interrupt boundary.",
            )
        decision = interrupt(payload)
        if isinstance(decision, dict) and decision.get("kind") == "content_pack_persisted":
            try:
                receipt = ContentPackPersistenceReceiptV1.model_validate(decision)
                approval_payload = ContentApprovalInterruptV1.model_validate(payload)
            except ValidationError as exc:
                return _failure_state(
                    state,
                    code="ORCHESTRATION_VALIDATION_FAILED",
                    message=f"Persisted Content receipt failed contract validation: {exc}",
                )
            orchestration_model = _orchestration_model(state)
            if not approval_payload.persistence_required:
                return _failure_state(
                    state,
                    code="ORCHESTRATION_STALE_RESUME",
                    message="The Content persistence receipt was already attached.",
                )
            if not _receipt_matches(receipt, orchestration_model):
                return _failure_state(
                    state,
                    code="ORCHESTRATION_STALE_RESUME",
                    message="Persisted Content receipt does not match the draft item.",
                )
            updated_payload = approval_payload.model_copy(
                update={"persistence_required": False}
            )
            orchestration = _replace_orchestration(
                state,
                status="awaiting_content_approval",
                current_role="content",
                current_stage="content_approval",
                summary="Nest persisted the immutable Content draft; awaiting the owner decision.",
            )
            return _bump(
                state,
                orchestration=orchestration,
                approval_interrupt=updated_payload.model_dump(mode="json"),
            )

        resume_idempotency_key: str | None = None
        if isinstance(decision, dict) and "decision_binding" in decision:
            resume_idempotency_key = decision.get("resume_idempotency_key")
            decision = decision.get("decision_binding")
            if not isinstance(resume_idempotency_key, str) or not resume_idempotency_key:
                return _failure_state(
                    state,
                    code="ORCHESTRATION_VALIDATION_FAILED",
                    message="Owner Content decision is missing its idempotency key.",
                )

        try:
            binding = ContentDecisionBindingV1.model_validate(decision)
        except ValidationError as exc:
            return _failure_state(
                state,
                code="ORCHESTRATION_VALIDATION_FAILED",
                message=f"Owner Content decision failed contract validation: {exc}",
            )

        orchestration_model = _orchestration_model(state)
        payload_model = ContentApprovalInterruptV1.model_validate(payload)
        if payload_model.persistence_required or not _decision_matches(binding, orchestration_model):
            return _failure_state(
                state,
                code="ORCHESTRATION_STALE_RESUME",
                message="Owner Content decision does not match the persisted draft item.",
            )

        content = orchestration_model.content.model_copy(
            update={"pending_decision": False, "decision_binding": binding}
        )
        if binding.decision != "approved":
            orchestration = _replace_orchestration(
                state,
                status="cancelled",
                current_role=None,
                current_stage="cancelled",
                content=content,
                summary=(
                    f"Owner Content decision recorded: {binding.decision}; "
                    "the orchestration will not create a publication action."
                ),
            )
        else:
            orchestration = _replace_orchestration(
                state,
                status="completed",
                current_role=None,
                current_stage="complete",
                content=content,
                summary=(
                    "Owner approved the exact Content item version; publishing remains "
                    "outside the orchestration graph."
                ),
            )
        return _bump(
            state,
            orchestration=orchestration,
            approval_binding=binding.model_dump(mode="json"),
            resume_idempotency_key=resume_idempotency_key,
        )

    def terminal_node(_state: Phase4GraphState) -> dict[str, Any]:
        return {}

    def route_after_content(state: Phase4GraphState) -> Literal["review", "terminal"]:
        return "terminal" if state.get("phase4_error") else "review"

    def route_after_review(
        state: Phase4GraphState,
    ) -> Literal["replan", "await_approval", "terminal"]:
        if state.get("phase4_error"):
            return "terminal"
        review = ContentQualityReviewV1.model_validate(state["quality_review"])
        if review.valid:
            return "await_approval"
        return "replan" if review.repairable else "terminal"

    def route_after_approval(
        state: Phase4GraphState,
    ) -> Literal["await_approval", "terminal"]:
        if state.get("phase4_error") or state.get("approval_binding"):
            return "terminal"
        return "await_approval"

    builder = StateGraph(Phase4GraphState)
    builder.add_node("content", content_node)
    builder.add_node("review", review_node)
    builder.add_node("await_approval", await_approval_node)
    builder.add_node("terminal", terminal_node)
    builder.add_edge(START, "content")
    builder.add_conditional_edges(
        "content",
        route_after_content,
        {"review": "review", "terminal": "terminal"},
    )
    builder.add_conditional_edges(
        "review",
        route_after_review,
        {
            "replan": "content",
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
class Phase4StartResult:
    result: CampaignOrchestrationResultV1
    approval_interrupt: ContentApprovalInterruptV1 | None
    draft_handoff: ContentDraftHandoffV1 | None


@dataclass(frozen=True)
class Phase4ResumeResult:
    result: CampaignOrchestrationResultV1


class Phase4Runner:
    """Start/resume facade with exact Content persistence and decision checks."""

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

    async def start(
        self,
        request: Phase4InputV1 | PreparedPhase4InputV1,
    ) -> Phase4StartResult:
        try:
            prepared = (
                validate_prepared_phase4_input(request)
                if isinstance(request, PreparedPhase4InputV1)
                else prepare_phase4_input(request)
            )
        except Phase4PreparationError as exc:
            raise Phase4RunError(exc.code, str(exc)) from exc

        run_id = prepared.start.run_id
        async with self._acquire(run_id):
            config = self._config(run_id)
            existing = await self.graph.aget_state(config)
            if existing is not None and (
                existing.values or existing.next or existing.interrupts
            ):
                raise Phase4RunError(
                    "ORCHESTRATION_DUPLICATE_START",
                    "An orchestration checkpoint already exists for this run.",
                )
            try:
                await self.graph.ainvoke(_initial_state(prepared), config)
                snapshot = await self.graph.aget_state(config)
            except Exception as exc:
                raise Phase4RunError(
                    "ORCHESTRATION_CHECKPOINT_FAILURE",
                    f"Phase 4 graph start failed: {exc}",
                ) from exc
            return self._start_result(snapshot, run_id)

    def _start_result(self, snapshot: Any, run_id: str) -> Phase4StartResult:
        result = self._result_from_snapshot(snapshot, run_id)
        approval = None
        if snapshot.interrupts:
            approval = ContentApprovalInterruptV1.model_validate(
                snapshot.interrupts[0].value
            )
        elif snapshot.values.get("approval_interrupt"):
            approval = ContentApprovalInterruptV1.model_validate(
                snapshot.values["approval_interrupt"]
            )
        handoff = None
        if approval is not None and snapshot.values.get("content_pack"):
            handoff = self._draft_handoff(snapshot.values)
        return Phase4StartResult(
            result=result,
            approval_interrupt=approval,
            draft_handoff=handoff,
        )

    async def attach_persisted_pack(
        self,
        receipt: ContentPackPersistenceReceiptV1,
    ) -> ContentApprovalInterruptV1:
        async with self._acquire(receipt.run_id):
            config = self._config(receipt.run_id)
            snapshot = await self.graph.aget_state(config)
            if snapshot is None or not snapshot.next or not snapshot.interrupts:
                raise Phase4RunError(
                    "ORCHESTRATION_STALE_RESUME",
                    "The orchestration is not paused for a Content persistence receipt.",
                )
            orchestration = CampaignOrchestrationStateV1.model_validate(
                snapshot.values["orchestration"]
            )
            payload = ContentApprovalInterruptV1.model_validate(
                snapshot.interrupts[0].value
            )
            if not payload.persistence_required:
                raise Phase4RunError(
                    "ORCHESTRATION_STALE_RESUME",
                    "The Content persistence receipt was already attached.",
                )
            if not _receipt_matches(receipt, orchestration):
                raise Phase4RunError(
                    "ORCHESTRATION_STALE_RESUME",
                    "Persisted Content receipt does not match the paused draft item.",
                )
            try:
                await self.graph.ainvoke(
                    Command(resume=receipt.model_dump(mode="json")),
                    config,
                )
                updated = await self.graph.aget_state(config)
            except Exception as exc:
                raise Phase4RunError(
                    "ORCHESTRATION_CHECKPOINT_FAILURE",
                    f"Content persistence receipt could not be checkpointed: {exc}",
                ) from exc
            if not updated.interrupts:
                raise Phase4RunError(
                    "ORCHESTRATION_CHECKPOINT_FAILURE",
                    "Content persistence receipt did not leave an owner approval interrupt.",
                )
            return ContentApprovalInterruptV1.model_validate(
                updated.interrupts[0].value
            )

    async def resume(self, request: CampaignOrchestrationResumeV1) -> Phase4ResumeResult:
        run_id = request.run_id
        async with self._acquire(run_id):
            config = self._config(run_id)
            snapshot = await self.graph.aget_state(config)
            if snapshot is None:
                raise Phase4RunError(
                    "ORCHESTRATION_STALE_RESUME",
                    "The orchestration is not paused at a resumable Content approval.",
                )
            values = snapshot.values
            if not snapshot.next or not snapshot.interrupts:
                completed_key = values.get("resume_idempotency_key")
                completed_binding = values.get("approval_binding")
                if completed_key == request.idempotency_key and completed_binding is not None:
                    if completed_binding != request.decision_binding.model_dump(mode="json"):
                        raise Phase4RunError(
                            "ORCHESTRATION_SCOPE_MISMATCH",
                            "The resume idempotency key was already used with a different decision.",
                        )
                    self._validate_resume_scope(request, values)
                    return Phase4ResumeResult(self._result_from_snapshot(snapshot, run_id))
                raise Phase4RunError(
                    "ORCHESTRATION_STALE_RESUME",
                    "The orchestration is not paused at a resumable Content approval.",
                )
            self._validate_resume_scope(request, values)
            try:
                await self.graph.ainvoke(
                    Command(
                        resume={
                            "decision_binding": request.decision_binding.model_dump(mode="json"),
                            "resume_idempotency_key": request.idempotency_key,
                        }
                    ),
                    config,
                )
                updated = await self.graph.aget_state(config)
            except Phase4RunError:
                raise
            except Exception as exc:
                raise Phase4RunError(
                    "ORCHESTRATION_CHECKPOINT_FAILURE",
                    f"Phase 4 graph resume failed: {exc}",
                ) from exc
            if updated.interrupts:
                raise Phase4RunError(
                    "ORCHESTRATION_CHECKPOINT_FAILURE",
                    "Phase 4 decision resume unexpectedly paused again.",
                )
            return Phase4ResumeResult(self._result_from_snapshot(updated, run_id))

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
            raise Phase4RunError(
                "ORCHESTRATION_CHECKPOINT_FAILURE",
                f"Paused Phase 4 state is invalid: {exc}",
            ) from exc

        if not isinstance(binding, ContentDecisionBindingV1):
            raise Phase4RunError(
                "ORCHESTRATION_SCOPE_MISMATCH",
                "A Content approval binding is required for this checkpoint.",
            )
        if (
            request.checkpoint_thread_id != request.run_id
            or request.run_id != orchestration.run_id
            or request.business_id != orchestration.business_id
            or request.owner_user_id != orchestration.owner_user_id
            or request.correlation_id != start.correlation_id
        ):
            raise Phase4RunError(
                "ORCHESTRATION_SCOPE_MISMATCH",
                "Resume request does not match the paused run owner or scope.",
            )
        if not _decision_matches(binding, orchestration):
            raise Phase4RunError(
                "ORCHESTRATION_STALE_RESUME",
                "Resume binding is stale or belongs to another Content item version.",
            )
        payload = ContentApprovalInterruptV1.model_validate(
            values.get("approval_interrupt", {})
        )
        if payload.persistence_required:
            raise Phase4RunError(
                "ORCHESTRATION_STALE_RESUME",
                "Nest must attach the Content persistence receipt before owner approval.",
            )

    @staticmethod
    def _result_from_snapshot(snapshot: Any, run_id: str) -> CampaignOrchestrationResultV1:
        values = snapshot.values
        state = CampaignOrchestrationStateV1.model_validate(values["orchestration"])
        raw_error = values.get("phase4_error")
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
    def _draft_handoff(values: dict[str, Any]) -> ContentDraftHandoffV1:
        state = CampaignOrchestrationStateV1.model_validate(values["orchestration"])
        start = CampaignOrchestrationStartV1.model_validate(
            values["input_snapshot"]["start"]
        )

        return ContentDraftHandoffV1(
            contract_version="content-draft-handoff-v1",
            run_id=state.run_id,
            business_id=state.business_id,
            owner_user_id=state.owner_user_id,
            strategy_id=state.immutable_input.strategy_id,
            strategy_version=state.strategy.version or 0,
            strategy_decision=StrategyDecisionBindingV1.model_validate(
                values["strategy_decision"]
            ),
            pack=ContentPack.model_validate(values["content_pack"]),
            item_versions=[
                ContentItemVersion.model_validate(item)
                for item in values["item_versions"]
            ],
            validation=ContentValidationResult.model_validate(values["validation"]),
            quality_review=ContentQualityReviewV1.model_validate(values["quality_review"]),
            immutable_input_refs={
                **start.model_dump(mode="json"),
                "content_cycle_id": state.content.cycle_id,
                "content_pack_id": state.content.pack_id,
            },
        )


def _receipt_matches(
    receipt: ContentPackPersistenceReceiptV1,
    orchestration: CampaignOrchestrationStateV1,
) -> bool:
    content = orchestration.content
    return (
        receipt.run_id == orchestration.run_id
        and receipt.business_id == orchestration.business_id
        and receipt.strategy_id == orchestration.immutable_input.strategy_id
        and receipt.content_cycle_id == content.cycle_id
        and receipt.content_pack_id == content.pack_id
        and receipt.content_item_id == content.item_id
        and receipt.content_item_version_id == content.item_version_id
        and receipt.content_item_version == content.item_version
        and receipt.content_item_version_checksum == content.checksum
    )


def _decision_matches(
    binding: ContentDecisionBindingV1,
    orchestration: CampaignOrchestrationStateV1,
) -> bool:
    content = orchestration.content
    return (
        binding.run_id == orchestration.run_id
        and binding.business_id == orchestration.business_id
        and binding.decided_by_user_id == orchestration.owner_user_id
        and binding.content_cycle_id == content.cycle_id
        and binding.content_pack_id == content.pack_id
        and binding.content_item_id == content.item_id
        and binding.content_item_version_id == content.item_version_id
        and binding.content_item_version == content.item_version
        and binding.content_item_version_checksum == content.checksum
    )
