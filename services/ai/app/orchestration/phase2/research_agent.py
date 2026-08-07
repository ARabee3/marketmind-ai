"""Bounded Research Agent controller for the Phase 2 tool proof."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Literal, Protocol

from pydantic import Field

from content_base import FrozenModel
from orchestration_contracts import (
    CampaignOrchestrationStartV1,
    ResearchAssumptionV1,
    ResearchFactV1,
    ResearchKnowledgeGapV1,
    ResearchPackV1,
)

from app.discovery.schemas import PreparedDiscoveryIntake
from app.decisions.explanations import StrategyDecisionBundle
from app.rag.schemas import RetrievedKnowledgePack, RetrievalQueryContext
from app.search.schemas import (
    EvidenceTriageCandidate,
    EvidenceTriageResult,
    QueryPlan,
)
from strategy_contracts import BusinessProfilePayload, StrategyBrief

from .contracts import ApprovedKnowledgeSearchResult
from .registry import (
    ResearchToolContext,
    ToolBudget,
    ToolExecutionError,
    ToolRegistry,
)


class ToolSelection(FrozenModel):
    tool_name: str = Field(min_length=1, max_length=80)
    arguments: dict[str, Any] = Field(default_factory=dict)


class StopDecision(FrozenModel):
    reason: Literal["sufficient_evidence", "owner_blocker"]


class ResearchAgentInput(FrozenModel):
    start: CampaignOrchestrationStartV1
    intake: PreparedDiscoveryIntake
    discovery_candidates: list[EvidenceTriageCandidate] = Field(
        default_factory=list, max_length=40
    )
    retrieval_query_context: RetrievalQueryContext | None = None
    business_profile: BusinessProfilePayload | None = None
    strategy_brief: StrategyBrief | None = None
    retrieval_pack: RetrievedKnowledgePack | None = None
    minimum_fact_count: int = Field(default=1, ge=1, le=40)
    minimum_tool_count: int = Field(default=3, ge=1, le=4)


class ResearchAgentView(FrozenModel):
    """Small selector view; raw evidence text is deliberately not exposed here."""

    fact_count: int = Field(ge=0)
    gap_count: int = Field(ge=0)
    available_candidate_indices: list[int]
    tools_used: list[str]
    remaining_tool_calls: int = Field(ge=0)
    query_plan_ready: bool
    evidence_triage_ready: bool
    knowledge_search_ready: bool
    strategy_decisions_ready: bool


class ResearchToolSelector(Protocol):
    async def select(
        self,
        view: ResearchAgentView,
    ) -> ToolSelection | StopDecision: ...


ResearchContextBuilder = Callable[[ResearchAgentInput], ResearchToolContext]


@dataclass
class _ResearchState:
    input: ResearchAgentInput
    budget: ToolBudget
    facts: dict[str, ResearchFactV1] = field(default_factory=dict)
    assumptions: list[ResearchAssumptionV1] = field(default_factory=list)
    gaps: dict[str, ResearchKnowledgeGapV1] = field(default_factory=dict)
    tools_used: list[str] = field(default_factory=list)
    action_summaries: list[str] = field(default_factory=list)
    stable_errors: list[str] = field(default_factory=list)
    query_plan_ready: bool = False
    evidence_triage_ready: bool = False
    knowledge_search_ready: bool = False
    strategy_decisions_ready: bool = False


@dataclass(frozen=True)
class ResearchAgentResult:
    pack: ResearchPackV1
    tools_used: tuple[str, ...]
    tool_calls_used: int
    action_summaries: tuple[str, ...]
    stable_errors: tuple[str, ...]


class DeterministicResearchSelector:
    """Safe mock selector for CI and demo rehearsal.

    A credentialed provider selector can implement the same protocol later;
    the registry and budget rules remain outside model control.
    """

    async def select(
        self,
        view: ResearchAgentView,
    ) -> ToolSelection | StopDecision:
        if not view.query_plan_ready:
            return ToolSelection(
                tool_name="plan_trusted_research_queries",
                arguments={"language_mode": "mixed"},
            )
        if not view.evidence_triage_ready and view.available_candidate_indices:
            return ToolSelection(
                tool_name="triage_research_evidence",
                arguments={
                    "candidate_indices": view.available_candidate_indices,
                    "language_mode": "mixed",
                },
            )
        if not view.knowledge_search_ready:
            return ToolSelection(
                tool_name="search_approved_marketing_knowledge",
                arguments={"focus_category": "framework_diagnosis", "max_results": 4},
            )
        return StopDecision(reason="sufficient_evidence")


class ResearchAgent:
    def __init__(
        self,
        registry: ToolRegistry,
        selector: ResearchToolSelector,
        *,
        now: Callable[[], datetime] | None = None,
        context_builder: ResearchContextBuilder | None = None,
    ) -> None:
        self.registry = registry
        self.selector = selector
        self._now = now or (lambda: datetime.now(timezone.utc))
        self._context_builder = context_builder

    async def run(self, request: ResearchAgentInput) -> ResearchAgentResult:
        state = _ResearchState(
            input=request,
            budget=ToolBudget(
                limit=request.start.bounds.tool_calls_limit,
                used=request.start.bounds.tool_calls_used,
            ),
        )
        try:
            context = self._build_context(request)
        except ToolExecutionError as exc:
            state.stable_errors.append(exc.code)
            state.action_summaries.append("Research context construction failed visibly.")
            pack = self._build_pack(state, "provider_failure")
            return ResearchAgentResult(
                pack=pack,
                tools_used=tuple(state.tools_used),
                tool_calls_used=state.budget.used,
                action_summaries=tuple(state.action_summaries),
                stable_errors=tuple(state.stable_errors),
            )

        stop_reason: str | None = None
        while stop_reason is None:
            if self._deadline_reached(request.start):
                stop_reason = "budget_exhausted"
                state.stable_errors.append("ORCHESTRATION_BUDGET_EXCEEDED")
                break
            if state.budget.used >= state.budget.limit:
                stop_reason = "budget_exhausted"
                state.stable_errors.append("ORCHESTRATION_BUDGET_EXCEEDED")
                break

            view = self._view(state)
            try:
                decision = await self.selector.select(view)
            except Exception as exc:
                state.stable_errors.append("ORCHESTRATION_PROVIDER_UNSUPPORTED")
                state.action_summaries.append(
                    f"Research selector failed visibly: {type(exc).__name__}."
                )
                stop_reason = "provider_failure"
                break

            if isinstance(decision, StopDecision):
                if decision.reason == "sufficient_evidence" and self._is_sufficient(state):
                    stop_reason = "sufficient_evidence"
                elif decision.reason == "owner_blocker":
                    stop_reason = "owner_blocker"
                else:
                    state.action_summaries.append(
                        "Selector requested sufficient evidence before the configured evidence gate was met."
                    )
                    stop_reason = "owner_blocker"
                break

            try:
                execution = await self.registry.execute(
                    decision.tool_name,
                    decision.arguments,
                    context,
                    state.budget,
                )
            except ToolExecutionError as exc:
                state.stable_errors.append(exc.code)
                state.action_summaries.append(
                    f"Tool {decision.tool_name} stopped with {exc.code}."
                )
                stop_reason = (
                    "budget_exhausted"
                    if exc.code == "ORCHESTRATION_BUDGET_EXCEEDED"
                    else "provider_failure"
                )
                break

            state.tools_used.append(execution.tool_name)
            self._ingest_result(state, execution.tool_name, execution.result)

            if self._has_blocking_gap(state):
                state.action_summaries.append(
                    "Research stopped because a blocking knowledge gap requires an owner decision."
                )
                stop_reason = "owner_blocker"
                continue

            if self._is_sufficient(state):
                # Give the selector one final chance to request a legitimate
                # owner blocker; otherwise the minimum evidence gate ends the run.
                if state.budget.used >= request.minimum_tool_count:
                    state.action_summaries.append(
                        f"Research evidence gate met after {state.budget.used} tool calls."
                    )
                    stop_reason = "sufficient_evidence"

        if stop_reason is None:
            stop_reason = "provider_failure"
        pack = self._build_pack(state, stop_reason)
        return ResearchAgentResult(
            pack=pack,
            tools_used=tuple(state.tools_used),
            tool_calls_used=state.budget.used,
            action_summaries=tuple(state.action_summaries),
            stable_errors=tuple(state.stable_errors),
        )

    def _build_context(self, request: ResearchAgentInput) -> ResearchToolContext:
        if self._context_builder is None:
            return ResearchToolContext(
                start=request.start,
                intake=request.intake,
                discovery_candidates=tuple(request.discovery_candidates),
                retrieval_query_context=request.retrieval_query_context,
                business_profile=request.business_profile,
                strategy_brief=request.strategy_brief,
                retrieval_pack=request.retrieval_pack,
            )

        context = self._context_builder(request)
        if (
            context.start != request.start
            or context.intake != request.intake
            or context.discovery_candidates != tuple(request.discovery_candidates)
        ):
            raise ToolExecutionError(
                "ORCHESTRATION_SCOPE_MISMATCH",
                "The server-built tool context does not match the immutable Research Agent input.",
            )
        return context

    def _view(self, state: _ResearchState) -> ResearchAgentView:
        used = set(state.tools_used)
        return ResearchAgentView(
            fact_count=len(state.facts),
            gap_count=len(state.gaps),
            available_candidate_indices=[
                candidate.index for candidate in state.input.discovery_candidates
            ],
            tools_used=list(state.tools_used),
            remaining_tool_calls=max(0, state.budget.limit - state.budget.used),
            query_plan_ready="plan_trusted_research_queries" in used,
            evidence_triage_ready="triage_research_evidence" in used,
            knowledge_search_ready="search_approved_marketing_knowledge" in used,
            strategy_decisions_ready="calculate_strategy_decisions" in used,
        )

    def _is_sufficient(self, state: _ResearchState) -> bool:
        return (
            len(state.facts) >= state.input.minimum_fact_count
            and len(set(state.tools_used)) >= state.input.minimum_tool_count
            and not self._has_blocking_gap(state)
        )

    @staticmethod
    def _has_blocking_gap(state: _ResearchState) -> bool:
        return any(gap.blocking for gap in state.gaps.values())

    def _deadline_reached(self, start: CampaignOrchestrationStartV1) -> bool:
        deadline = start.bounds.deadline_at
        if deadline is None:
            return False
        parsed = datetime.fromisoformat(deadline.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return self._now() >= parsed

    def _ingest_result(self, state: _ResearchState, tool_name: str, result: Any) -> None:
        state.action_summaries.append(f"Tool {tool_name} completed with a typed result.")
        if isinstance(result, ApprovedKnowledgeSearchResult):
            state.knowledge_search_ready = True
            for fact in result.facts:
                state.facts.setdefault(fact.source_ref, fact)
            for gap in result.knowledge_gaps:
                self._record_gap(state, gap)
            return
        if isinstance(result, EvidenceTriageResult):
            state.evidence_triage_ready = True
            candidates = {
                candidate.index: candidate
                for candidate in state.input.discovery_candidates
            }
            fetched_at = self._iso_now()
            for decision in result.decisions:
                candidate = candidates.get(decision.index)
                if candidate is None:
                    continue
                if decision.evidence_tier == "discarded" or decision.classification == "irrelevant":
                    continue
                statement = decision.synthesized_observation
                if not statement:
                    continue
                source_ref = candidate.url or (
                    f"discovery://{candidate.provider}/{candidate.index}"
                )
                confidence = max(
                    0.0,
                    min(1.0, decision.confidence * candidate.provider_confidence),
                )
                state.facts.setdefault(
                    source_ref,
                    ResearchFactV1(
                        statement=self._bounded_text(statement, 700),
                        source_ref=source_ref,
                        source_kind="discovery_evidence",
                        fetched_at=fetched_at,
                        confidence=confidence,
                        relevance=confidence,
                    ),
                )
                if decision.suggested_owner_question:
                    state.assumptions.append(
                        ResearchAssumptionV1(
                            statement=self._bounded_text(statement, 700),
                            source_ref=source_ref,
                            reason=self._bounded_text(
                                decision.suggested_owner_question, 300
                            ),
                        )
                    )
            return
        if isinstance(result, QueryPlan):
            state.query_plan_ready = True
            if result.warnings:
                state.action_summaries.append(
                    f"Query planning returned {len(result.warnings)} visible warning(s)."
                )
            return
        if isinstance(result, StrategyDecisionBundle):
            state.strategy_decisions_ready = True
            for gap in result.knowledge_gaps:
                category = str(gap.get("category", "strategy"))
                self._record_gap(
                    state,
                    ResearchKnowledgeGapV1(
                        field_key=f"strategy:{category}",
                        question_hint=self._bounded_text(
                            str(gap.get("description", category)), 300
                        ),
                        priority=1 if gap.get("severity") == "blocking" else 2,
                        blocking=gap.get("severity") == "blocking",
                    ),
                )
            return

    @staticmethod
    def _record_gap(state: _ResearchState, gap: ResearchKnowledgeGapV1) -> None:
        existing = state.gaps.get(gap.field_key)
        if existing is None or (
            gap.blocking and not existing.blocking
        ) or (
            gap.blocking == existing.blocking and gap.priority < existing.priority
        ):
            state.gaps[gap.field_key] = gap

    def _build_pack(self, state: _ResearchState, stop_reason: str) -> ResearchPackV1:
        return ResearchPackV1(
            contract_version="research-pack-v1",
            run_id=state.input.start.run_id,
            business_id=state.input.start.business_id,
            profile_version_id=state.input.start.confirmed_profile_version_id,
            facts=list(state.facts.values()),
            assumptions=state.assumptions,
            knowledge_gaps=list(state.gaps.values()),
            source_quality_summary=(
                f"{len(state.facts)} cited fact(s) from "
                f"{len(set(state.tools_used))} reviewed tool(s)."
            ),
            stop_reason=stop_reason,  # type: ignore[arg-type]
        )

    def _iso_now(self) -> str:
        return self._iso_utc(self._now())

    @staticmethod
    def _iso_utc(value: datetime) -> str:
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")

    @staticmethod
    def _bounded_text(value: str, maximum: int) -> str:
        compact = " ".join(value.split())
        return compact[:maximum] if compact else "No evidence text supplied."
