"""Mock rehearsal of the complete Research -> Strategy -> Content journey.

This deliberately composes the isolated graph segments instead of mounting a
new production route.  It proves that the typed handoffs and exact owner
decision bindings line up across the first demo slice while the feature flag
and existing domain paths remain untouched.
"""

from __future__ import annotations

import json

import pytest
from langgraph.checkpoint.memory import MemorySaver

from app.content.validators import validate_content_generation_request
from app.discovery.schemas import PreparedDiscoveryIntake
from app.orchestration.phase2 import (
    DeterministicResearchSelector,
    ResearchAgent,
    ResearchAgentInput,
)
from app.orchestration.phase3 import (
    Phase3InputV1,
    Phase3Runner,
    StrategyDraftPersistenceReceiptV1,
    StrategySegment,
    build_phase3_graph,
    strategy_plan_checksum,
)
from app.orchestration.phase4 import (
    ContentPackPersistenceReceiptV1,
    Phase4InputV1,
    Phase4Runner,
    ContentSegment,
    build_phase4_graph,
)
from app.providers.content_provider import MockContentProvider
from app.providers.strategy_provider import MockStrategyProvider
from app.search.schemas import EvidenceTriageCandidate
from orchestration_contracts import (
    CampaignOrchestrationResumeV1,
    ContentDecisionBindingV1,
    StrategyDecisionBindingV1,
)
from strategy_contracts import BusinessProfilePayload, StrategyBrief

from tests.content.fixture_helpers import make_valid_request
from tests.orchestration.conftest import (
    BRIEF_ID,
    BUSINESS_ID,
    OWNER_ID,
    PROFILE_VERSION_ID,
    RUN_ID,
    STRATEGY_ID,
    make_start,
)
from tests.orchestration.test_phase2_tools import build_registry
from tests.strategy.fixtures import (
    default_brief,
    default_business_profile,
    default_retrieval_pack,
)


STRATEGY_VERSION_ID = "77777777-7777-4777-8777-777777777777"
STRATEGY_DECISION_ID = "88888888-8888-4888-8888-888888888888"
CONTENT_DECISION_ID = "99999999-9999-4999-8999-999999999999"


def _phase2_request() -> ResearchAgentInput:
    return ResearchAgentInput(
        start=make_start(),
        intake=PreparedDiscoveryIntake(
            business_name="Koshary Corner",
            business_type="quick service restaurant",
            city="Cairo",
            area="Nasr City",
            owner_goal_text="Increase local orders with a small practical budget.",
            target_audience_text="Nearby families and office workers.",
            notes="Synthetic vertical-slice rehearsal.",
        ),
        discovery_candidates=[
            EvidenceTriageCandidate(
                index=0,
                intent="business_match",
                provider="metadata",
                title="Synthetic local listing",
                url="https://example.test/koshary-corner",
                snippet="The listing confirms a local presence in Nasr City.",
                query="Koshary Corner Nasr City",
                rank=1,
                provider_confidence=0.9,
                metadata={"fixture": "vertical-slice"},
            )
        ],
        minimum_fact_count=1,
        minimum_tool_count=3,
    )


def _phase3_input(research_pack) -> Phase3InputV1:
    start = make_start()
    profile: BusinessProfilePayload = default_business_profile().model_copy(
        update={
            "id": PROFILE_VERSION_ID,
            "business_id": BUSINESS_ID,
            "version": 1,
            "confirmed_by_user_id": OWNER_ID,
        }
    )
    profile_ref = default_brief().business_profile_version.model_copy(
        update={
            "business_profile_version_id": PROFILE_VERSION_ID,
            "version": 1,
            "confirmed_at": profile.confirmed_at,
        }
    )
    brief: StrategyBrief = default_brief().model_copy(
        update={
            "id": BRIEF_ID,
            "strategy_id": STRATEGY_ID,
            "business_profile_version": profile_ref,
        }
    )
    retrieval = default_retrieval_pack().model_copy(
        update={"profile_version_id": PROFILE_VERSION_ID, "brief_id": BRIEF_ID}
    )
    return Phase3InputV1(
        contract_version="phase3-input-v1",
        start=start,
        business_profile=profile,
        strategy_brief=brief,
        retrieval_pack=retrieval,
        research_pack=research_pack,
    )


def _strategy_resume(started) -> CampaignOrchestrationResumeV1:
    approval = started.approval_interrupt
    assert approval is not None
    binding = StrategyDecisionBindingV1(
        binding_type="strategy",
        run_id=RUN_ID,
        business_id=BUSINESS_ID,
        strategy_id=STRATEGY_ID,
        strategy_version_id=STRATEGY_VERSION_ID,
        strategy_version=approval.strategy_version,
        strategy_checksum=approval.strategy_checksum,
        decision_id=STRATEGY_DECISION_ID,
        decision="approved",
        decided_by_user_id=OWNER_ID,
        decided_at="2026-08-07T08:15:00.000Z",
    )
    return CampaignOrchestrationResumeV1(
        contract_version="orchestration-v1",
        run_id=RUN_ID,
        checkpoint_thread_id=RUN_ID,
        correlation_id="phase2-correlation",
        idempotency_key="vertical-strategy-resume",
        owner_user_id=OWNER_ID,
        business_id=BUSINESS_ID,
        decision_binding=binding,
        requested_at="2026-08-07T08:15:00.000Z",
    )


def _phase4_input(started_strategy, start):
    base_request = make_valid_request()
    plan = started_strategy.draft_handoff.plan
    profile = base_request.business_profile.model_copy(
        update={
            "id": PROFILE_VERSION_ID,
            "business_id": BUSINESS_ID,
            "version": 1,
            "confirmed_by_user_id": OWNER_ID,
        }
    )
    week_context = base_request.week_context
    content_request = base_request.model_copy(
        update={
            "business_id": BUSINESS_ID,
            "business_profile": profile,
            "strategy_id": STRATEGY_ID,
            "strategy_version": plan.version,
            "strategy_decision_id": STRATEGY_DECISION_ID,
            "strategy_plan": plan,
        }
    )
    content_start = start.model_copy(
        update={
            "week_context_id": week_context.id,
            "week_context_checksum": "b" * 64,
        }
    )
    strategy_decision = StrategyDecisionBindingV1(
        binding_type="strategy",
        run_id=content_start.run_id,
        business_id=content_start.business_id,
        strategy_id=content_start.strategy_id,
        strategy_version_id=STRATEGY_VERSION_ID,
        strategy_version=plan.version,
        strategy_checksum=strategy_plan_checksum(plan),
        decision_id=STRATEGY_DECISION_ID,
        decision="approved",
        decided_by_user_id=content_start.owner_user_id,
        decided_at="2026-08-07T08:15:00.000Z",
    )
    request = Phase4InputV1(
        contract_version="phase4-input-v1",
        start=content_start,
        strategy_decision=strategy_decision,
        content_request=content_request,
    )
    assert validate_content_generation_request(request.content_request).valid
    return request


def _content_resume(started) -> CampaignOrchestrationResumeV1:
    approval = started.approval_interrupt
    assert approval is not None
    binding = ContentDecisionBindingV1(
        binding_type="content",
        run_id=approval.run_id,
        business_id=approval.business_id,
        content_cycle_id=approval.content_cycle_id,
        content_pack_id=approval.content_pack_id,
        content_item_id=approval.content_item_id,
        content_item_version_id=approval.content_item_version_id,
        content_item_version=approval.content_item_version,
        content_item_version_checksum=approval.content_item_version_checksum,
        decision_id=CONTENT_DECISION_ID,
        decision="approved",
        decided_by_user_id=approval.owner_user_id,
        decided_at="2026-08-07T08:20:00.000Z",
    )
    return CampaignOrchestrationResumeV1(
        contract_version="orchestration-v1",
        run_id=approval.run_id,
        checkpoint_thread_id=approval.run_id,
        correlation_id="phase2-correlation",
        idempotency_key="vertical-content-resume",
        owner_user_id=approval.owner_user_id,
        business_id=approval.business_id,
        decision_binding=binding,
        requested_at="2026-08-07T08:20:00.000Z",
    )


async def run_mock_vertical_slice() -> dict[str, object]:
    """Run the deterministic demo journey and return reviewable evidence."""

    start = make_start()
    research_registry, _ = build_registry()
    research_request = _phase2_request().model_copy(update={"start": start})
    research = await ResearchAgent(
        research_registry, DeterministicResearchSelector()
    ).run(research_request)

    phase3_request = _phase3_input(research.pack)
    phase3 = Phase3Runner(
        build_phase3_graph(MemorySaver(), StrategySegment(MockStrategyProvider()))
    )
    started_strategy = await phase3.start(phase3_request)
    strategy_approval = started_strategy.approval_interrupt
    assert strategy_approval is not None
    await phase3.attach_persisted_draft(
        StrategyDraftPersistenceReceiptV1(
            kind="strategy_draft_persisted",
            run_id=strategy_approval.run_id,
            business_id=strategy_approval.business_id,
            strategy_id=strategy_approval.strategy_id,
            draft_id=strategy_approval.draft_id,
            strategy_version_id=STRATEGY_VERSION_ID,
            strategy_version=strategy_approval.strategy_version,
            strategy_checksum=strategy_approval.strategy_checksum,
        )
    )
    resumed_strategy = await phase3.resume(_strategy_resume(started_strategy))

    phase4_request = _phase4_input(started_strategy, start)
    phase4 = Phase4Runner(
        build_phase4_graph(MemorySaver(), ContentSegment(MockContentProvider()))
    )
    started_content = await phase4.start(phase4_request)
    content_approval = started_content.approval_interrupt
    assert content_approval is not None
    await phase4.attach_persisted_pack(
        ContentPackPersistenceReceiptV1(
            kind="content_pack_persisted",
            run_id=content_approval.run_id,
            business_id=content_approval.business_id,
            strategy_id=content_approval.strategy_id,
            content_cycle_id=content_approval.content_cycle_id,
            content_pack_id=content_approval.content_pack_id,
            content_item_id=content_approval.content_item_id,
            content_item_version_id=content_approval.content_item_version_id,
            content_item_version=content_approval.content_item_version,
            content_item_version_checksum=content_approval.content_item_version_checksum,
        )
    )
    resumed_content = await phase4.resume(_content_resume(started_content))

    return {
        "run_id": start.run_id,
        "research": {
            "stop_reason": research.pack.stop_reason,
            "tool_calls": research.tool_calls_used,
            "tools": list(research.tools_used),
            "cited_facts": len(research.pack.facts),
        },
        "strategy": {
            "paused": started_strategy.result.status,
            "approved_resume": resumed_strategy.result.status,
            "persistence_required": strategy_approval.persistence_required,
            "plan_checksum": strategy_approval.strategy_checksum,
        },
        "content": {
            "paused": started_content.result.status,
            "draft_items": len(started_content.draft_handoff.item_versions),
            "completed_resume": resumed_content.result.status,
            "persistence_required": content_approval.persistence_required,
            "publication_actions": 0,
        },
    }


@pytest.mark.asyncio
async def test_mock_vertical_slice_runs_research_strategy_content_and_approval():
    evidence = await run_mock_vertical_slice()

    assert evidence["research"] == {
        "stop_reason": "sufficient_evidence",
        "tool_calls": 3,
        "tools": [
            "plan_trusted_research_queries",
            "triage_research_evidence",
            "search_approved_marketing_knowledge",
        ],
        "cited_facts": 2,
    }
    assert evidence["strategy"]["paused"] == "awaiting_strategy_approval"
    assert evidence["strategy"]["approved_resume"] == "running"
    assert evidence["strategy"]["persistence_required"] is True
    assert evidence["content"] == {
        "paused": "awaiting_content_approval",
        "draft_items": 3,
        "completed_resume": "completed",
        "persistence_required": True,
        "publication_actions": 0,
    }
    print(json.dumps(evidence, sort_keys=True))
