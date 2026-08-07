from __future__ import annotations

import pytest
from langgraph.checkpoint.memory import MemorySaver

from orchestration_contracts import (
    CampaignOrchestrationResumeV1,
    ResearchFactV1,
    ResearchKnowledgeGapV1,
    ResearchPackV1,
    StrategyDecisionBindingV1,
)
from strategy_contracts import StrategyPlan

from app.orchestration.phase3 import (
    DeterministicStrategyQualityReviewer,
    Phase3InputV1,
    Phase3RunError,
    Phase3Runner,
    StrategyQualityReviewV1,
    StrategyDraftPersistenceReceiptV1,
    StrategySegment,
    build_phase3_graph,
    prepare_phase3_input,
    strategy_plan_checksum,
)
from app.providers.strategy_provider import MockStrategyProvider, StrategyLLMProvider

from tests.strategy.fixtures import (
    default_brief,
    default_business_profile,
    default_retrieval_pack,
)
from tests.orchestration.conftest import (
    BRIEF_ID,
    BUSINESS_ID,
    OWNER_ID,
    PROFILE_VERSION_ID,
    RUN_ID,
    STRATEGY_ID,
    make_start,
    start_with_bounds,
)


def _phase3_input(*, start=None) -> Phase3InputV1:
    start = start or make_start()
    profile = default_business_profile().model_copy(
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
    brief = default_brief().model_copy(
        update={
            "id": BRIEF_ID,
            "strategy_id": STRATEGY_ID,
            "business_profile_version": profile_ref,
        }
    )
    retrieval = default_retrieval_pack().model_copy(
        update={
            "profile_version_id": PROFILE_VERSION_ID,
            "brief_id": BRIEF_ID,
        }
    )
    research = ResearchPackV1(
        contract_version="research-pack-v1",
        run_id=start.run_id,
        business_id=start.business_id,
        profile_version_id=start.confirmed_profile_version_id,
        facts=[
            ResearchFactV1(
                statement="Owner-confirmed local demand evidence is available.",
                source_ref="discovery:candidate:0",
                source_kind="discovery_evidence",
                fetched_at="2026-08-07T08:00:00.000Z",
                confidence=0.9,
                relevance=0.9,
            )
        ],
        assumptions=[],
        knowledge_gaps=[],
        source_quality_summary="Synthetic test evidence with explicit provenance.",
        stop_reason="sufficient_evidence",
    )
    return Phase3InputV1(
        contract_version="phase3-input-v1",
        start=start,
        business_profile=profile,
        strategy_brief=brief,
        retrieval_pack=retrieval,
        research_pack=research,
    )


def _runner(provider: StrategyLLMProvider | None = None, reviewer=None):
    checkpointer = MemorySaver()
    graph = build_phase3_graph(
        checkpointer,
        StrategySegment(provider or MockStrategyProvider()),
        reviewer,
    )
    return Phase3Runner(graph)


class RecordingStrategyProvider(MockStrategyProvider):
    def __init__(self):
        super().__init__()
        self.prompts = []

    async def generate_strategy_plan(self, prompt):
        self.prompts.append(prompt)
        return await super().generate_strategy_plan(prompt)


@pytest.mark.asyncio
async def test_phase3_preparation_is_immutable_and_builds_typed_handoff():
    request = _phase3_input()
    before = request.model_dump(mode="json")

    prepared = prepare_phase3_input(request)

    assert prepared.handoff.run_id == RUN_ID
    assert prepared.handoff.strategy_request.strategy_id == STRATEGY_ID
    assert prepared.handoff.strategy_request.brief.id == BRIEF_ID
    assert prepared.handoff.strategy_request.business_profile.id == PROFILE_VERSION_ID
    assert prepared.handoff.strategy_request.deterministic_channel_scores
    assert request.model_dump(mode="json") == before


def test_phase3_preparation_rejects_cross_business_research_pack():
    request = _phase3_input()
    request = request.model_copy(
        update={
            "research_pack": request.research_pack.model_copy(
                update={"business_id": "88888888-8888-4888-8888-888888888888"}
            )
        }
    )

    with pytest.raises(ValueError, match="does not match"):
        prepare_phase3_input(request)


def test_phase3_preparation_rejects_blocking_research_gap():
    request = _phase3_input()
    blocked = request.research_pack.model_copy(
        update={
            "knowledge_gaps": [
                ResearchKnowledgeGapV1(
                    field_key="budget:paid_media",
                    question_hint="Confirm paid-media budget.",
                    priority=1,
                    blocking=True,
                )
            ]
        }
    )

    with pytest.raises(ValueError, match="blocking gap"):
        prepare_phase3_input(request.model_copy(update={"research_pack": blocked}))


def test_strategy_plan_checksum_is_canonical():
    request = _phase3_input()
    prepared = prepare_phase3_input(request)
    # The checksum is independent of model field insertion order and stable
    # across repeated serialization.
    plan = MockStrategyProvider().fixture_plan
    assert strategy_plan_checksum(plan) == strategy_plan_checksum(
        StrategyPlan.model_validate(plan.model_dump(mode="json"))
    )
    assert len(strategy_plan_checksum(plan)) == 64
    assert prepared.handoff.strategy_request.strategy_id == request.start.strategy_id


@pytest.mark.asyncio
async def test_phase3_runner_revalidates_direct_prepared_handoffs():
    prepared = prepare_phase3_input(_phase3_input())
    altered_request = prepared.handoff.strategy_request.model_copy(
        update={"strategy_id": "99999999-9999-4999-8999-999999999999"}
    )
    altered_handoff = prepared.handoff.model_copy(
        update={"strategy_request": altered_request}
    )
    tampered = prepared.model_copy(update={"handoff": altered_handoff})

    with pytest.raises(Phase3RunError) as error:
        await _runner().start(tampered)

    assert error.value.code == "ORCHESTRATION_SCOPE_MISMATCH"


@pytest.mark.asyncio
async def test_phase3_start_pauses_with_valid_immutable_draft_and_no_write_side_effect():
    provider = MockStrategyProvider()
    runner = _runner(provider)

    started = await runner.start(_phase3_input())

    assert started.result.status == "awaiting_strategy_approval"
    assert started.result.state.strategy.pending_decision is True
    assert started.approval_interrupt is not None
    assert started.approval_interrupt.persistence_required is True
    assert started.approval_interrupt.strategy_checksum == started.draft_handoff.strategy_checksum
    assert started.draft_handoff.plan.id == started.approval_interrupt.draft_id
    assert started.draft_handoff.validation.valid is True
    # MockStrategyProvider is called once; the graph has no persistence
    # callback, so generation itself cannot duplicate an external write.
    assert started.draft_handoff.research_pack.stop_reason == "sufficient_evidence"

    with pytest.raises(Phase3RunError) as duplicate:
        await runner.start(_phase3_input())
    assert duplicate.value.code == "ORCHESTRATION_DUPLICATE_START"


@pytest.mark.asyncio
async def test_phase3_strategy_prompt_receives_bounded_research_pack():
    marker = "UNIQUE-RESEARCH-FACT-DO-NOT-LOSE"
    request = _phase3_input()
    research = request.research_pack.model_copy(
        update={
            "facts": [
                ResearchFactV1(
                    statement=marker,
                    source_ref="discovery:candidate:unique",
                    source_kind="discovery_evidence",
                    fetched_at="2026-08-07T08:00:00.000Z",
                    confidence=0.99,
                    relevance=0.99,
                )
            ]
        }
    )
    provider = RecordingStrategyProvider()

    started = await _runner(provider).start(
        request.model_copy(update={"research_pack": research})
    )

    assert started.approval_interrupt is not None
    assert provider.prompts
    prompt = provider.prompts[0]
    assert marker in prompt.user_prompt
    assert "research_pack" in prompt.user_prompt
    assert "untrusted data" in prompt.system_prompt
    assert "Research Pack" in prompt.system_prompt
    assert prompt.metadata["research_run_id"] == request.start.run_id
    assert prompt.metadata["research_handoff_prompt_version"] == "research-handoff-v1"


@pytest.mark.asyncio
async def test_phase3_fails_closed_before_provider_when_bounds_are_exhausted():
    start = start_with_bounds(
        make_start(),
        deadline_at="2020-01-01T00:00:00.000Z",
        token_budget=0,
        cost_budget_usd=0.0,
    )
    provider = RecordingStrategyProvider()

    result = await _runner(provider).start(_phase3_input(start=start))

    assert result.approval_interrupt is None
    assert result.result.status == "failed"
    assert result.result.error is not None
    assert result.result.error.code == "ORCHESTRATION_BUDGET_EXCEEDED"
    assert provider.prompts == []


class RepairOnceReviewer:
    def __init__(self):
        self.calls = 0

    async def review(self, plan, validation):
        self.calls += 1
        if self.calls == 1:
            return StrategyQualityReviewV1(
                contract_version="strategy-quality-review-v1",
                artifact_type="strategy_plan",
                valid=False,
                issue_code="STRATEGY_RULE_VIOLATION",
                field="plan.positioning.text",
                severity="warning",
                repairable=True,
                short_explanation="Clarify the positioning sentence for the owner.",
                recommended_node="strategy",
            )
        return await DeterministicStrategyQualityReviewer().review(plan, validation)


@pytest.mark.asyncio
async def test_phase3_replans_only_strategy_and_reuses_research_handoff():
    provider = MockStrategyProvider()
    reviewer = RepairOnceReviewer()
    runner = _runner(provider, reviewer)

    started = await runner.start(_phase3_input())

    assert started.result.status == "awaiting_strategy_approval"
    assert started.result.state.bounds.replans_used == 1
    assert reviewer.calls == 2
    assert started.draft_handoff.research_pack.run_id == RUN_ID


class AlwaysRepairableReviewer:
    async def review(self, plan, validation):
        return StrategyQualityReviewV1(
            contract_version="strategy-quality-review-v1",
            artifact_type="strategy_plan",
            valid=False,
            issue_code="STRATEGY_RULE_VIOLATION",
            field="plan.positioning.text",
            severity="warning",
            repairable=True,
            short_explanation="A bounded repair is still required.",
            recommended_node="strategy",
        )


@pytest.mark.asyncio
async def test_phase3_replan_cap_is_terminal_and_does_not_pause():
    start = start_with_bounds(make_start(), replans_limit=1)
    runner = _runner(reviewer=AlwaysRepairableReviewer())

    result = await runner.start(_phase3_input(start=start))

    assert result.approval_interrupt is None
    assert result.result.status == "failed"
    assert result.result.error is not None
    assert result.result.error.code == "ORCHESTRATION_BUDGET_EXCEEDED"
    assert result.result.state.bounds.replans_used == 1


class InvalidPlanProvider(MockStrategyProvider):
    def __init__(self):
        super().__init__()
        self.calls = 0

    async def generate_strategy_plan(self, prompt):
        self.calls += 1
        plan = await super().generate_strategy_plan(prompt)
        return plan.model_copy(update={"brief_id": "99999999-9999-4999-8999-999999999999"})


@pytest.mark.asyncio
async def test_phase3_hard_validation_failure_is_visible_and_never_interrupted():
    provider = InvalidPlanProvider()
    runner = _runner(provider)

    result = await runner.start(_phase3_input())

    assert result.approval_interrupt is None
    assert result.result.status == "failed"
    assert result.result.error is not None
    assert result.result.error.code == "ORCHESTRATION_VALIDATION_FAILED"
    assert provider.calls == 3


def _resume_request(
    started,
    *,
    owner_id=OWNER_ID,
    checksum=None,
    decision="approved",
):
    approval = started.approval_interrupt
    assert approval is not None
    binding = StrategyDecisionBindingV1(
        binding_type="strategy",
        run_id=RUN_ID,
        business_id=BUSINESS_ID,
        strategy_id=STRATEGY_ID,
        strategy_version_id="77777777-7777-4777-8777-777777777777",
        strategy_version=approval.strategy_version,
        strategy_checksum=checksum or approval.strategy_checksum,
        decision_id="88888888-8888-4888-8888-888888888888",
        decision=decision,
        decided_by_user_id=owner_id,
        decided_at="2026-08-07T08:15:00.000Z",
    )
    return CampaignOrchestrationResumeV1(
        contract_version="orchestration-v1",
        run_id=RUN_ID,
        checkpoint_thread_id=RUN_ID,
        correlation_id="phase2-correlation",
        idempotency_key="phase2-idempotency",
        owner_user_id=owner_id,
        business_id=BUSINESS_ID,
        decision_binding=binding,
        requested_at="2026-08-07T08:15:00.000Z",
    )


@pytest.mark.asyncio
async def test_phase3_resume_survives_new_runner_and_rejects_stale_or_cross_owner_requests():
    provider = MockStrategyProvider()
    checkpointer = MemorySaver()
    graph = build_phase3_graph(checkpointer, StrategySegment(provider))
    runner = Phase3Runner(graph)
    started = await runner.start(_phase3_input())

    with pytest.raises(Phase3RunError) as cross_owner:
        await runner.resume(_resume_request(started, owner_id="99999999-9999-4999-8999-999999999999"))
    assert cross_owner.value.code == "ORCHESTRATION_SCOPE_MISMATCH"

    with pytest.raises(Phase3RunError) as stale:
        await runner.resume(_resume_request(started, checksum="b" * 64))
    assert stale.value.code == "ORCHESTRATION_STALE_RESUME"

    approval = started.approval_interrupt
    assert approval is not None
    owner_payload = await runner.attach_persisted_draft(
        StrategyDraftPersistenceReceiptV1(
            kind="strategy_draft_persisted",
            run_id=RUN_ID,
            business_id=BUSINESS_ID,
            strategy_id=STRATEGY_ID,
            draft_id=approval.draft_id,
            strategy_version_id="77777777-7777-4777-8777-777777777777",
            strategy_version=approval.strategy_version,
            strategy_checksum=approval.strategy_checksum,
        )
    )
    assert owner_payload.persistence_required is False

    restarted_runner = Phase3Runner(graph)
    resumed = await restarted_runner.resume(_resume_request(started))
    assert resumed.result.status == "running"
    assert resumed.result.state.strategy.pending_decision is False
    assert resumed.result.state.strategy.decision_binding is not None
    assert resumed.result.state.strategy.version_id == "77777777-7777-4777-8777-777777777777"

    with pytest.raises(Phase3RunError) as duplicate:
        await restarted_runner.resume(_resume_request(started))
    assert duplicate.value.code == "ORCHESTRATION_STALE_RESUME"


@pytest.mark.asyncio
@pytest.mark.parametrize("decision", ["rejected", "revision_requested"])
async def test_phase3_non_approved_decision_cannot_continue(decision):
    runner = _runner()
    started = await runner.start(_phase3_input())
    approval = started.approval_interrupt
    assert approval is not None

    await runner.attach_persisted_draft(
        StrategyDraftPersistenceReceiptV1(
            kind="strategy_draft_persisted",
            run_id=RUN_ID,
            business_id=BUSINESS_ID,
            strategy_id=STRATEGY_ID,
            draft_id=approval.draft_id,
            strategy_version_id="77777777-7777-4777-8777-777777777777",
            strategy_version=approval.strategy_version,
            strategy_checksum=approval.strategy_checksum,
        )
    )

    resumed = await runner.resume(_resume_request(started, decision=decision))

    assert resumed.result.status == "cancelled"
    assert resumed.result.state.strategy.pending_decision is False
    assert resumed.result.state.strategy.decision_binding is not None
    assert resumed.result.state.strategy.decision_binding.decision == decision
