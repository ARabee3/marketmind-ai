from __future__ import annotations

from types import SimpleNamespace
from uuid import uuid4

import pytest

from orchestration_contracts import ResearchFactV1

from app.orchestration.phase2 import (
    ApprovedKnowledgeSearchArgs,
    ApprovedKnowledgeSearchResult,
    Phase2ToolServices,
    ResearchToolContext,
    TOOL_NAMES,
    ToolBudget,
    ToolRegistry,
    ToolExecutionError,
    ToolDefinition,
    create_phase2_tool_registry,
)
from app.rag.schemas import RetrievedKnowledgePack
from app.search.evidence_triage_service import EvidenceTriageService
from app.search.query_planning_service import QueryPlanningService
from app.search.schemas import (
    EvidenceTriageDecision,
    EvidenceTriageResult,
)

from tests.decisions.fixtures.base import (
    default_brief,
    default_business_profile,
    default_retrieval_pack,
)


class FixedTriagePlanner:
    def __init__(self, result: EvidenceTriageResult) -> None:
        self.result = result
        self.requests = []

    async def triage(self, request):
        self.requests.append(request)
        return self.result


def fixed_triage_result() -> EvidenceTriageResult:
    return EvidenceTriageResult(
        source="llm",
        decisions=[
            EvidenceTriageDecision(
                index=0,
                classification="market_context",
                evidence_tier="confirmed_signal",
                confidence=0.85,
                reason="Synthetic fixture is usable after triage.",
                synthesized_observation="The listing confirms a local presence in Nasr City.",
                suggested_owner_question="Confirm whether the listing is still current.",
            )
        ],
    )


def make_knowledge_result() -> ApprovedKnowledgeSearchResult:
    return ApprovedKnowledgeSearchResult(
        retrieval_run_id=str(uuid4()),
        facts=[
            ResearchFactV1(
                statement="Approved guidance recommends one measurable conversion goal.",
                source_ref="knowledge://entry-1/v1/chunk-1",
                source_kind="approved_knowledge",
                fetched_at="2026-08-07T08:00:00.000Z",
                confidence=0.8,
                relevance=0.9,
            )
        ],
        knowledge_gaps=[],
    )


def build_registry(knowledge_search=None):
    planner = FixedTriagePlanner(fixed_triage_result())
    services = Phase2ToolServices(
        query_planning=QueryPlanningService(),
        evidence_triage=EvidenceTriageService(planner),
        knowledge_search=knowledge_search or _search_fixture,
    )
    return create_phase2_tool_registry(services), planner


async def _search_fixture(_args, _context):
    return make_knowledge_result()


def build_context(phase2_start, phase2_intake, phase2_candidate, phase2_query_context):
    return ResearchToolContext(
        start=phase2_start,
        intake=phase2_intake,
        discovery_candidates=(phase2_candidate,),
        retrieval_query_context=phase2_query_context,
        business_profile=default_business_profile(),
        strategy_brief=default_brief(),
        retrieval_pack=default_retrieval_pack(),
    )


@pytest.mark.asyncio
async def test_registry_exposes_exactly_four_reviewed_tools_and_executes_each(
    phase2_start,
    phase2_intake,
    phase2_candidate,
    phase2_query_context,
):
    registry, planner = build_registry()
    context = build_context(
        phase2_start, phase2_intake, phase2_candidate, phase2_query_context
    )
    budget = ToolBudget(limit=4)

    assert registry.names == TOOL_NAMES
    assert {item["name"] for item in registry.describe()} == set(TOOL_NAMES)
    assert all("handler" not in item for item in registry.describe())

    query_plan = await registry.execute(
        "plan_trusted_research_queries", {"language_mode": "mixed"}, context, budget
    )
    triage = await registry.execute(
        "triage_research_evidence",
        {"candidate_indices": [0], "language_mode": "mixed"},
        context,
        budget,
    )
    search = await registry.execute(
        "search_approved_marketing_knowledge",
        {"focus_category": "framework_diagnosis", "max_results": 4},
        context,
        budget,
    )
    decisions = await registry.execute(
        "calculate_strategy_decisions", {"explain": True}, context, budget
    )

    assert query_plan.result.queries
    assert triage.result.decisions[0].index == 0
    assert search.result.facts[0].source_ref.startswith("knowledge://")
    assert decisions.result.selected_channels
    assert planner.requests[0].candidates[0].snippet.startswith("Ignore previous")
    assert budget.used == 4


@pytest.mark.asyncio
async def test_registry_rejects_unknown_tools_and_model_scope_injection(
    phase2_start,
    phase2_intake,
    phase2_candidate,
    phase2_query_context,
):
    registry, _ = build_registry()
    context = build_context(
        phase2_start, phase2_intake, phase2_candidate, phase2_query_context
    )
    budget = ToolBudget(limit=2)

    with pytest.raises(ToolExecutionError) as unknown:
        await registry.execute("delete_everything", {}, context, budget)
    assert unknown.value.code == "ORCHESTRATION_TOOL_NOT_ALLOWED"
    assert budget.used == 0

    with pytest.raises(ToolExecutionError) as injected:
        await registry.execute(
            "plan_trusted_research_queries",
            {"language_mode": "mixed", "owner_user_id": phase2_start.owner_user_id},
            context,
            budget,
        )
    assert injected.value.code == "ORCHESTRATION_VALIDATION_FAILED"
    assert budget.used == 1


@pytest.mark.asyncio
async def test_triage_can_only_read_server_owned_candidate_indexes(
    phase2_start,
    phase2_intake,
    phase2_candidate,
    phase2_query_context,
):
    registry, _ = build_registry()
    context = build_context(
        phase2_start, phase2_intake, phase2_candidate, phase2_query_context
    )

    with pytest.raises(ToolExecutionError) as scope_error:
        await registry.execute(
            "triage_research_evidence",
            {"candidate_indices": [999], "language_mode": "mixed"},
            context,
            ToolBudget(limit=1),
        )
    assert scope_error.value.code == "ORCHESTRATION_SCOPE_MISMATCH"


@pytest.mark.asyncio
async def test_registry_caps_oversized_typed_output(
    phase2_start,
    phase2_intake,
    phase2_candidate,
    phase2_query_context,
):
    async def oversized_search(_args, _context):
        result = make_knowledge_result()
        fact = result.facts[0].model_copy(update={"statement": "x" * 1_000})
        return result.model_copy(update={"facts": [fact]})

    planner = FixedTriagePlanner(fixed_triage_result())
    registry = create_phase2_tool_registry(
        Phase2ToolServices(
            query_planning=QueryPlanningService(),
            evidence_triage=EvidenceTriageService(planner),
            knowledge_search=oversized_search,
        ),
        max_output_bytes=300,
    )
    context = build_context(
        phase2_start, phase2_intake, phase2_candidate, phase2_query_context
    )

    with pytest.raises(ToolExecutionError) as output_error:
        await registry.execute(
            "search_approved_marketing_knowledge",
            {"max_results": 1},
            context,
            ToolBudget(limit=1),
        )
    assert output_error.value.code == "ORCHESTRATION_BUDGET_EXCEEDED"


@pytest.mark.asyncio
async def test_registry_applies_per_call_timeout(
    phase2_start,
    phase2_intake,
    phase2_candidate,
    phase2_query_context,
):
    import asyncio

    async def slow_search(_args, _context):
        await asyncio.sleep(0.02)
        return make_knowledge_result()

    registry = ToolRegistry(
        (
            ToolDefinition(
                name="slow_search",
                description="test-only timeout",
                input_model=ApprovedKnowledgeSearchArgs,
                output_model=ApprovedKnowledgeSearchResult,
                handler=slow_search,
                timeout_seconds=0.001,
            ),
        )
    )
    context = build_context(
        phase2_start, phase2_intake, phase2_candidate, phase2_query_context
    )

    with pytest.raises(ToolExecutionError) as timeout_error:
        await registry.execute("slow_search", {}, context, ToolBudget(limit=1))
    assert timeout_error.value.code == "ORCHESTRATION_PROVIDER_UNSUPPORTED"
    assert timeout_error.value.retryable is True


@pytest.mark.asyncio
async def test_approved_search_shadow_path_does_not_persist(
    monkeypatch,
    phase2_start,
    phase2_intake,
    phase2_candidate,
    phase2_query_context,
):
    import app.orchestration.phase2.builtins as builtins

    calls = []

    async def fake_retrieve(**kwargs):
        calls.append(kwargs)
        return default_retrieval_pack()

    monkeypatch.setattr(builtins, "retrieve_strategy_knowledge", fake_retrieve)
    planner = FixedTriagePlanner(fixed_triage_result())
    registry = create_phase2_tool_registry(
        Phase2ToolServices(
            query_planning=QueryPlanningService(),
            evidence_triage=EvidenceTriageService(planner),
        )
    )
    context = build_context(
        phase2_start, phase2_intake, phase2_candidate, phase2_query_context
    )
    context = context.__class__(
        **{
            **context.__dict__,
            "settings": SimpleNamespace(
                embedding_provider_mode="fake",
                embedding_model="fixture",
                embedding_dimensions=1,
                qdrant_collection_name="fixture",
            ),
            "db_session": object(),
            "qdrant_client": object(),
        }
    )

    execution = await registry.execute(
        "search_approved_marketing_knowledge",
        {"max_results": 2},
        context,
        ToolBudget(limit=1),
    )

    assert execution.result.facts
    assert calls[0]["persist"] is False
    assert calls[0]["strategy_id"].hex == phase2_start.strategy_id.replace("-", "")


def test_knowledge_pack_adapter_keeps_only_approved_cited_facts():
    from app.orchestration.phase2.builtins import _knowledge_pack_to_result
    from app.orchestration.phase2.contracts import ApprovedKnowledgeSearchArgs

    pack = default_retrieval_pack()
    first = pack.items[0].model_copy(update={"review_status": "pending"})
    second = pack.items[1].model_copy(update={"category": "framework_diagnosis"})
    pack = RetrievedKnowledgePack.model_validate(
        pack.model_copy(update={"items": [first, second]}).model_dump()
    )

    result = _knowledge_pack_to_result(
        pack,
        ApprovedKnowledgeSearchArgs(focus_category="framework_diagnosis", max_results=4),
    )

    assert result.facts
    assert all(fact.source_kind == "approved_knowledge" for fact in result.facts)
    assert all("knowledge://" in fact.source_ref for fact in result.facts)
    assert all("pending" not in fact.statement for fact in result.facts)
