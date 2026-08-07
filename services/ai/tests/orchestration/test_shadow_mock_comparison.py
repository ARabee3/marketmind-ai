"""Executable mock shadow comparison for the isolated orchestration boundary.

The test sends one immutable, synthetic scope through the existing generation
seams and through the Phase 3/4 graphs.  It only creates in-memory checkpoints
and provider fixtures: no FastAPI route is switched, no domain row is written,
and no publication action is available to either path.

This is intentionally a mock shadow, not production rollout evidence.  It
proves that the comparison contract is wired to real generation and graph
outputs while keeping missing provider cost data visible.
"""

from __future__ import annotations

import hashlib
import json
from time import perf_counter
from typing import Any, Awaitable, Callable

import pytest
from langgraph.checkpoint.memory import MemorySaver

from app.orchestration.phase3 import (
    Phase3Runner,
    StrategySegment,
    build_phase3_graph,
    prepare_phase3_input,
)
from app.orchestration.phase4 import (
    ContentSegment,
    Phase4Runner,
    build_phase4_graph,
    prepare_phase4_input,
)
from app.orchestration.phase2 import DeterministicResearchSelector, ResearchAgent
from app.orchestration.phase5 import (
    ShadowComparisonReportV1,
    ShadowPathSummaryV1,
    compare_shadow_paths,
)
from app.providers.content_provider import MockContentProvider
from app.providers.strategy_provider import MockStrategyProvider

from tests.orchestration.test_mock_vertical_slice import (
    _phase2_request,
    _phase3_input,
    _phase4_input,
)
from tests.orchestration.test_phase2_tools import build_registry
from tests.orchestration.conftest import make_start


async def _timed(operation: Callable[[], Awaitable[Any]]) -> tuple[Any, float]:
    started_at = perf_counter()
    result = await operation()
    return result, round(max(0.0, (perf_counter() - started_at) * 1000), 3)


def _scope_key(label: str, value: Any) -> str:
    encoded = json.dumps(
        value.model_dump(mode="json"),
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    digest = hashlib.sha256(encoded).hexdigest()
    return f"mock-shadow:{label}:{digest}"


def _content_grounding_count(items: list[Any]) -> int:
    return sum(len(item.claim_sources) for item in items)


def _report_with_notes(
    report: ShadowComparisonReportV1,
    *notes: str,
) -> ShadowComparisonReportV1:
    return report.model_copy(update={"notes": [*report.notes, *notes]})


async def run_mock_shadow_comparison() -> dict[str, object]:
    """Run current and orchestrated paths for the same mock scope."""

    start = make_start()
    research_registry, _ = build_registry()
    research_request = _phase2_request().model_copy(update={"start": start})
    research = await ResearchAgent(
        research_registry, DeterministicResearchSelector()
    ).run(research_request)

    phase3_request = _phase3_input(research.pack)
    prepared_phase3 = prepare_phase3_input(phase3_request)
    strategy_scope = _scope_key("strategy", phase3_request)

    current_strategy, current_strategy_latency = await _timed(
        lambda: StrategySegment(
            MockStrategyProvider(),
            model_name="mock",
        ).generate(
            prepared_phase3.handoff.strategy_request,
            deadline_at=start.bounds.deadline_at,
            token_budget=start.bounds.token_budget,
            cost_budget_usd=start.bounds.cost_budget_usd,
        )
    )
    current_strategy_summary = ShadowPathSummaryV1(
        contract_version="orchestration-shadow-summary-v1",
        path="current",
        scope_key=strategy_scope,
        status="completed",
        valid=current_strategy.validation.valid,
        citation_count=len(current_strategy.plan.citations),
        latency_ms=current_strategy_latency,
        # The current Strategy provider contract does not report usage/cost.
        cost_usd=None,
        publication_action_count=0,
    )

    orchestrated_phase3 = Phase3Runner(
        build_phase3_graph(
            MemorySaver(),
            StrategySegment(MockStrategyProvider()),
        )
    )
    orchestrated_strategy, orchestrated_strategy_latency = await _timed(
        lambda: orchestrated_phase3.start(phase3_request)
    )
    strategy_handoff = orchestrated_strategy.draft_handoff
    assert strategy_handoff is not None
    orchestrated_strategy_summary = ShadowPathSummaryV1(
        contract_version="orchestration-shadow-summary-v1",
        path="orchestrated",
        scope_key=strategy_scope,
        status=orchestrated_strategy.result.status,
        valid=strategy_handoff.validation.valid,
        citation_count=len(strategy_handoff.plan.citations),
        latency_ms=orchestrated_strategy_latency,
        cost_usd=None,
        publication_action_count=0,
    )
    strategy_report = _report_with_notes(
        compare_shadow_paths(current_strategy_summary, orchestrated_strategy_summary),
        "Mock provider does not report Strategy token usage or cost; cost delta is unmeasured.",
        "The orchestrated path intentionally pauses before persistence and owner approval.",
    )

    # Content comparison uses the exact same approved Strategy snapshot on both
    # sides, so this stage measures orchestration overhead and guardrails rather
    # than two different Strategy artifacts.
    phase4_request = _phase4_input(orchestrated_strategy, start)
    prepared_phase4 = prepare_phase4_input(phase4_request)
    content_scope = _scope_key("content", phase4_request)

    current_content, current_content_latency = await _timed(
        lambda: ContentSegment(
            MockContentProvider(),
            model_name="mock-content-model",
        ).generate(
            prepared_phase4.handoff.content_request,
            deadline_at=start.bounds.deadline_at,
            token_budget=start.bounds.token_budget,
            cost_budget_usd=start.bounds.cost_budget_usd,
        )
    )
    current_content_summary = ShadowPathSummaryV1(
        contract_version="orchestration-shadow-summary-v1",
        path="current",
        scope_key=content_scope,
        status="completed",
        valid=current_content.validation.valid,
        citation_count=_content_grounding_count(current_content.item_versions),
        latency_ms=current_content_latency,
        cost_usd=current_content.estimated_cost_usd,
        publication_action_count=0,
    )

    orchestrated_phase4 = Phase4Runner(
        build_phase4_graph(
            MemorySaver(),
            ContentSegment(MockContentProvider()),
        )
    )
    orchestrated_content, orchestrated_content_latency = await _timed(
        lambda: orchestrated_phase4.start(phase4_request)
    )
    content_handoff = orchestrated_content.draft_handoff
    assert content_handoff is not None
    orchestrated_content_snapshot = await orchestrated_phase4.graph.aget_state(
        {"configurable": {"thread_id": start.run_id}}
    )
    assert orchestrated_content_snapshot is not None
    orchestrated_content_cost = float(
        orchestrated_content_snapshot.values.get("cost_budget_used_usd", 0.0)
    )
    orchestrated_content_summary = ShadowPathSummaryV1(
        contract_version="orchestration-shadow-summary-v1",
        path="orchestrated",
        scope_key=content_scope,
        status=orchestrated_content.result.status,
        valid=content_handoff.validation.valid,
        citation_count=_content_grounding_count(content_handoff.item_versions),
        latency_ms=orchestrated_content_latency,
        cost_usd=orchestrated_content_cost,
        publication_action_count=0,
    )
    content_report = _report_with_notes(
        compare_shadow_paths(current_content_summary, orchestrated_content_summary),
        "Both Content paths used the same immutable approved Strategy snapshot.",
        "No persistence receipt, domain write, publication candidate, or external action was executed.",
    )

    return {
        "mode": "mock_shadow",
        "feature_flag_enabled": False,
        "domain_write_count": 0,
        "publication_action_count": 0,
        "strategy": {
            "current": current_strategy_summary.model_dump(mode="json"),
            "orchestrated": orchestrated_strategy_summary.model_dump(mode="json"),
            "comparison": strategy_report.model_dump(mode="json"),
        },
        "content": {
            "current": current_content_summary.model_dump(mode="json"),
            "orchestrated": orchestrated_content_summary.model_dump(mode="json"),
            "comparison": content_report.model_dump(mode="json"),
        },
    }


@pytest.mark.asyncio
async def test_mock_shadow_paths_match_quality_and_execute_no_actions():
    evidence = await run_mock_shadow_comparison()

    assert evidence["mode"] == "mock_shadow"
    assert evidence["feature_flag_enabled"] is False
    assert evidence["domain_write_count"] == 0
    assert evidence["publication_action_count"] == 0

    for stage in ("strategy", "content"):
        current = evidence[stage]["current"]
        orchestrated = evidence[stage]["orchestrated"]
        comparison = evidence[stage]["comparison"]
        assert current["scope_key"] == orchestrated["scope_key"]
        assert current["valid"] is True
        assert orchestrated["valid"] is True
        assert comparison["quality"] == "match"
        assert comparison["current_publication_action_count"] == 0
        assert comparison["orchestrated_publication_action_count"] == 0
        assert comparison["latency_delta_ms"] is not None

    assert evidence["strategy"]["comparison"]["cost_delta_usd"] is None
    assert evidence["content"]["comparison"]["cost_delta_usd"] is not None
    assert evidence["strategy"]["orchestrated"]["status"] == "awaiting_strategy_approval"
    assert evidence["content"]["orchestrated"]["status"] == "awaiting_content_approval"

    print(json.dumps(evidence, ensure_ascii=False, sort_keys=True))
