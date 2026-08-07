from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.orchestration.phase2 import (
    DeterministicResearchSelector,
    ResearchAgent,
    ResearchAgentInput,
    StopDecision,
    ToolSelection,
)

from tests.decisions.fixtures.base import (
    default_brief,
    default_business_profile,
    default_retrieval_pack,
)

from tests.orchestration.conftest import start_with_bounds
from tests.orchestration.test_phase2_tools import build_registry


FIXTURES = json.loads(
    (
        Path(__file__).parent / "fixtures" / "phase2_research_cases.json"
    ).read_text(encoding="utf-8")
)


def make_request(
    phase2_start,
    phase2_intake,
    phase2_candidate,
    *,
    tool_calls_limit: int = 4,
    minimum_tool_count: int = 3,
):
    start = start_with_bounds(phase2_start, tool_calls_limit=tool_calls_limit)
    return ResearchAgentInput(
        start=start,
        intake=phase2_intake,
        discovery_candidates=[phase2_candidate],
        minimum_fact_count=1,
        minimum_tool_count=minimum_tool_count,
    )


@pytest.mark.asyncio
async def test_research_agent_reaches_sufficient_evidence_with_three_tools(
    phase2_start,
    phase2_intake,
    phase2_candidate,
):
    registry, _ = build_registry()
    agent = ResearchAgent(registry, DeterministicResearchSelector())

    result = await agent.run(
        make_request(phase2_start, phase2_intake, phase2_candidate)
    )

    assert result.pack.stop_reason == "sufficient_evidence"
    assert result.tool_calls_used == 3
    assert set(result.tools_used) == {
        "plan_trusted_research_queries",
        "triage_research_evidence",
        "search_approved_marketing_knowledge",
    }
    assert result.pack.facts
    assert all(fact.source_ref for fact in result.pack.facts)
    assert all(fact.source_kind in {"discovery_evidence", "approved_knowledge"} for fact in result.pack.facts)
    assert result.pack.run_id == phase2_start.run_id
    assert result.pack.business_id == phase2_start.business_id


@pytest.mark.asyncio
async def test_research_agent_can_ingest_deterministic_strategy_calculations(
    phase2_start,
    phase2_intake,
    phase2_candidate,
):
    registry, _ = build_registry()

    class FourToolSelector:
        def __init__(self):
            self.decisions = [
                ToolSelection(
                    tool_name="plan_trusted_research_queries",
                    arguments={"language_mode": "mixed"},
                ),
                ToolSelection(
                    tool_name="triage_research_evidence",
                    arguments={"candidate_indices": [0], "language_mode": "mixed"},
                ),
                ToolSelection(
                    tool_name="search_approved_marketing_knowledge",
                    arguments={"max_results": 2},
                ),
                ToolSelection(
                    tool_name="calculate_strategy_decisions",
                    arguments={"explain": True},
                ),
            ]

        async def select(self, _view):
            return self.decisions.pop(0)

    request = ResearchAgentInput(
        start=phase2_start,
        intake=phase2_intake,
        discovery_candidates=[phase2_candidate],
        business_profile=default_business_profile(),
        strategy_brief=default_brief(),
        retrieval_pack=default_retrieval_pack(),
        minimum_tool_count=4,
    )
    result = await ResearchAgent(registry, FourToolSelector()).run(request)

    assert result.pack.stop_reason == "sufficient_evidence"
    assert result.tool_calls_used == 4
    assert result.tools_used[-1] == "calculate_strategy_decisions"


@pytest.mark.asyncio
async def test_research_agent_treats_prompt_injection_as_untrusted_data(
    phase2_start,
    phase2_intake,
    phase2_candidate,
):
    registry, _ = build_registry()

    class RecordingSelector:
        def __init__(self):
            self.views = []
            self.decisions = [
                ToolSelection(
                    tool_name="plan_trusted_research_queries",
                    arguments={"language_mode": "mixed"},
                ),
                ToolSelection(
                    tool_name="triage_research_evidence",
                    arguments={"candidate_indices": [0], "language_mode": "mixed"},
                ),
                ToolSelection(
                    tool_name="search_approved_marketing_knowledge",
                    arguments={"max_results": 2},
                ),
            ]

        async def select(self, view):
            self.views.append(view)
            return self.decisions.pop(0)

    selector = RecordingSelector()
    result = await ResearchAgent(registry, selector).run(
        make_request(phase2_start, phase2_intake, phase2_candidate)
    )

    serialized_views = " ".join(view.model_dump_json() for view in selector.views)
    assert "ignore previous instructions" not in serialized_views.lower()
    assert "delete_everything" not in serialized_views
    assert result.pack.stop_reason == "sufficient_evidence"


@pytest.mark.asyncio
async def test_research_agent_stops_at_immutable_tool_budget(
    phase2_start,
    phase2_intake,
    phase2_candidate,
):
    registry, _ = build_registry()
    request = make_request(
        phase2_start,
        phase2_intake,
        phase2_candidate,
        tool_calls_limit=2,
    )

    result = await ResearchAgent(registry, DeterministicResearchSelector()).run(request)

    assert result.pack.stop_reason == "budget_exhausted"
    assert result.tool_calls_used == 2
    assert "ORCHESTRATION_BUDGET_EXCEEDED" in result.stable_errors


@pytest.mark.asyncio
async def test_research_agent_stops_before_a_deadline(
    phase2_start,
    phase2_intake,
    phase2_candidate,
):
    registry, _ = build_registry()
    request = ResearchAgentInput(
        start=start_with_bounds(
            phase2_start,
            deadline_at="2020-01-01T00:00:00.000Z",
        ),
        intake=phase2_intake,
        discovery_candidates=[phase2_candidate],
    )

    result = await ResearchAgent(registry, DeterministicResearchSelector()).run(request)

    assert result.pack.stop_reason == "budget_exhausted"
    assert result.tool_calls_used == 0
    assert "ORCHESTRATION_BUDGET_EXCEEDED" in result.stable_errors


@pytest.mark.asyncio
async def test_research_agent_surfaces_owner_blocker_without_tool_call(
    phase2_start,
    phase2_intake,
    phase2_candidate,
):
    class OwnerBlockerSelector:
        async def select(self, _view):
            return StopDecision(reason="owner_blocker")

    registry, _ = build_registry()
    result = await ResearchAgent(registry, OwnerBlockerSelector()).run(
        make_request(phase2_start, phase2_intake, phase2_candidate)
    )

    assert result.pack.stop_reason == "owner_blocker"
    assert result.tool_calls_used == 0
    assert result.pack.facts == []


def test_phase2_evaluation_fixtures_cover_stop_and_provenance_gates():
    case_ids = {case["case_id"] for case in FIXTURES}
    assert case_ids == {
        "sufficient-evidence",
        "prompt-injection-candidate",
        "bounded-budget",
    }
    assert all(case["requires_provenance"] for case in FIXTURES)
    assert all(case["minimum_tool_count"] >= 3 for case in FIXTURES)
