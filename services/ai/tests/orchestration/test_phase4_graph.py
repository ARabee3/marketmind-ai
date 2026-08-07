from __future__ import annotations

import pytest
from langgraph.checkpoint.memory import MemorySaver
from orchestration_contracts import (
    CampaignOrchestrationResumeV1,
    ContentDecisionBindingV1,
    StrategyDecisionBindingV1,
)

from app.orchestration.phase3.checksum import strategy_plan_checksum
from app.orchestration.phase4 import (
    ContentApprovalInterruptV1,
    ContentPackPersistenceReceiptV1,
    ContentQualityReviewV1,
    ContentSegment,
    Phase4InputV1,
    Phase4RunError,
    Phase4Runner,
    build_phase4_graph,
    prepare_phase4_input,
)
from app.providers.content_provider import MockContentProvider

from tests.content.fixture_helpers import make_valid_request
from tests.orchestration.conftest import (
    BUSINESS_ID,
    OWNER_ID,
    PROFILE_VERSION_ID,
    RUN_ID,
    STRATEGY_ID,
    make_start,
    start_with_bounds,
)


STRATEGY_DECISION_ID = "88888888-8888-4888-8888-888888888888"
STRATEGY_VERSION_ID = "77777777-7777-4777-8777-777777777777"
CONTENT_DECISION_ID = "99999999-9999-4999-8999-999999999999"


def _phase4_input(*, start=None) -> Phase4InputV1:
    base = make_valid_request()
    plan = base.strategy_plan.model_copy(
        update={
            "strategy_id": STRATEGY_ID,
            "profile_version": base.strategy_plan.profile_version.model_copy(
                update={"business_profile_version_id": PROFILE_VERSION_ID}
            ),
        }
    )
    profile = base.business_profile.model_copy(
        update={"business_id": BUSINESS_ID, "id": PROFILE_VERSION_ID}
    )
    request = base.model_copy(
        update={
            "business_id": BUSINESS_ID,
            "business_profile": profile,
            "strategy_id": STRATEGY_ID,
            "strategy_plan": plan,
            "strategy_decision_id": STRATEGY_DECISION_ID,
        }
    )
    start = (start or make_start()).model_copy(
        update={
            "week_context_id": request.week_context.id,
            "week_context_checksum": "b" * 64,
        }
    )
    decision = StrategyDecisionBindingV1(
        binding_type="strategy",
        run_id=start.run_id,
        business_id=start.business_id,
        strategy_id=start.strategy_id,
        strategy_version_id=STRATEGY_VERSION_ID,
        strategy_version=request.strategy_version,
        strategy_checksum=strategy_plan_checksum(request.strategy_plan),
        decision_id=STRATEGY_DECISION_ID,
        decision="approved",
        decided_by_user_id=start.owner_user_id,
        decided_at="2026-08-07T08:15:00.000Z",
    )
    return Phase4InputV1(
        contract_version="phase4-input-v1",
        start=start,
        strategy_decision=decision,
        content_request=request,
    )


def _runner(provider=None, reviewer=None):
    graph = build_phase4_graph(
        MemorySaver(),
        ContentSegment(provider or MockContentProvider()),
        reviewer,
    )
    return Phase4Runner(graph)


class RecordingContentProvider(MockContentProvider):
    def __init__(self):
        super().__init__()
        self.prompts = []

    async def generate_content_pack(self, prompt):
        self.prompts.append(prompt)
        return await super().generate_content_pack(prompt)


def _persistence_receipt(started) -> ContentPackPersistenceReceiptV1:
    payload = started.approval_interrupt
    assert payload is not None
    return ContentPackPersistenceReceiptV1(
        kind="content_pack_persisted",
        run_id=payload.run_id,
        business_id=payload.business_id,
        strategy_id=payload.strategy_id,
        content_cycle_id=payload.content_cycle_id,
        content_pack_id=payload.content_pack_id,
        content_item_id=payload.content_item_id,
        content_item_version_id=payload.content_item_version_id,
        content_item_version=payload.content_item_version,
        content_item_version_checksum=payload.content_item_version_checksum,
    )


def _resume_request(
    started,
    *,
    decision="approved",
    checksum=None,
    idempotency_key="phase2-idempotency",
):
    payload = started.approval_interrupt
    assert isinstance(payload, ContentApprovalInterruptV1)
    binding = ContentDecisionBindingV1(
        binding_type="content",
        run_id=payload.run_id,
        business_id=payload.business_id,
        content_cycle_id=payload.content_cycle_id,
        content_pack_id=payload.content_pack_id,
        content_item_id=payload.content_item_id,
        content_item_version_id=payload.content_item_version_id,
        content_item_version=payload.content_item_version,
        content_item_version_checksum=checksum or payload.content_item_version_checksum,
        decision_id=CONTENT_DECISION_ID,
        decision=decision,
        decided_by_user_id=payload.owner_user_id,
        decided_at="2026-08-07T08:20:00.000Z",
    )
    return CampaignOrchestrationResumeV1(
        contract_version="orchestration-v1",
        run_id=payload.run_id,
        checkpoint_thread_id=payload.run_id,
        correlation_id="phase2-correlation",
        idempotency_key=idempotency_key,
        owner_user_id=payload.owner_user_id,
        business_id=payload.business_id,
        decision_binding=binding,
        requested_at="2026-08-07T08:20:00.000Z",
    )


@pytest.mark.asyncio
async def test_phase4_generates_week_one_pack_and_pauses_before_persistence():
    provider = RecordingContentProvider()
    started = await _runner(provider).start(_phase4_input())

    assert started.result.status == "awaiting_content_approval"
    assert started.approval_interrupt is not None
    assert started.approval_interrupt.persistence_required is True
    assert started.draft_handoff is not None
    assert started.draft_handoff.pack.status == "draft"
    assert len(started.draft_handoff.item_versions) == 3
    assert started.result.state.content.pending_decision is True
    assert provider.prompts
    assert "Content Agent" in provider.prompts[0].system_prompt


def test_phase4_requires_an_explicit_approved_strategy():
    request = _phase4_input()
    rejected = request.strategy_decision.model_copy(update={"decision": "rejected"})

    with pytest.raises(ValueError, match="approved Strategy"):
        prepare_phase4_input(request.model_copy(update={"strategy_decision": rejected}))


@pytest.mark.asyncio
async def test_phase4_revalidates_tampered_prepared_handoff():
    prepared = prepare_phase4_input(_phase4_input())
    altered_request = prepared.handoff.content_request.model_copy(
        update={"strategy_id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}
    )
    altered_handoff = prepared.handoff.model_copy(
        update={"content_request": altered_request}
    )

    with pytest.raises(Phase4RunError) as error:
        await _runner().start(prepared.model_copy(update={"handoff": altered_handoff}))

    assert error.value.code == "ORCHESTRATION_SCOPE_MISMATCH"


@pytest.mark.asyncio
async def test_phase4_exact_content_approval_completes_without_publication_action():
    runner = _runner()
    started = await runner.start(_phase4_input())
    await runner.attach_persisted_pack(_persistence_receipt(started))

    resumed = await runner.resume(_resume_request(started))

    assert resumed.result.status == "completed"
    assert resumed.result.state.current_stage == "complete"
    assert resumed.result.state.content.pending_decision is False
    assert resumed.result.state.content.decision_binding is not None
    assert resumed.result.state.content.decision_binding.decision == "approved"
    assert "publishing" in " ".join(resumed.result.state.audit.action_summaries).lower()


@pytest.mark.asyncio
async def test_phase4_accepts_a_distinct_resume_idempotency_key_and_replays_safely():
    runner = _runner()
    started = await runner.start(_phase4_input())
    await runner.attach_persisted_pack(_persistence_receipt(started))

    request = _resume_request(started, idempotency_key="content-resume-1")
    resumed = await runner.resume(request)
    replayed = await runner.resume(request)

    assert resumed.result.status == "completed"
    assert replayed.result.checkpoint_version == resumed.result.checkpoint_version

    with pytest.raises(Phase4RunError) as error:
        await runner.resume(
            _resume_request(
                started,
                decision="rejected",
                idempotency_key="content-resume-1",
            )
        )
    assert error.value.code == "ORCHESTRATION_SCOPE_MISMATCH"


@pytest.mark.asyncio
@pytest.mark.parametrize("decision", ["rejected", "revision_requested"])
async def test_phase4_non_approved_content_decision_cancels_without_publication(decision):
    runner = _runner()
    started = await runner.start(_phase4_input())
    await runner.attach_persisted_pack(_persistence_receipt(started))

    resumed = await runner.resume(_resume_request(started, decision=decision))

    assert resumed.result.status == "cancelled"
    assert resumed.result.state.content.pending_decision is False
    assert resumed.result.state.content.decision_binding.decision == decision


@pytest.mark.asyncio
async def test_phase4_rejects_stale_content_decision():
    runner = _runner()
    started = await runner.start(_phase4_input())
    await runner.attach_persisted_pack(_persistence_receipt(started))

    with pytest.raises(Phase4RunError) as error:
        await runner.resume(_resume_request(started, checksum="c" * 64))

    assert error.value.code == "ORCHESTRATION_STALE_RESUME"


class RepairOnceContentReviewer:
    def __init__(self):
        self.calls = 0

    async def review(self, items, validation):
        self.calls += 1
        if self.calls == 1:
            return ContentQualityReviewV1(
                contract_version="content-quality-review-v1",
                artifact_type="content_pack",
                valid=False,
                issue_code="CONTENT_POLICY_VIOLATION",
                field="item_versions[0].caption_variants",
                severity="warning",
                repairable=True,
                short_explanation="Vary the first item CTA.",
                recommended_node="content",
            )
        return ContentQualityReviewV1(
            contract_version="content-quality-review-v1",
            artifact_type="content_pack",
            valid=True,
            severity="info",
            repairable=False,
            short_explanation="Content pack passed the review gate.",
            recommended_node="owner",
        )


class DuplicateOnceContentProvider(RecordingContentProvider):
    async def generate_content_pack(self, prompt):
        items = await super().generate_content_pack(prompt)
        if len(self.prompts) == 1:
            items[1] = items[1].model_copy(
                update={"caption_variants": items[0].caption_variants}
            )
        return items


@pytest.mark.asyncio
async def test_phase4_replans_only_content_with_a_capped_review_loop():
    provider = RecordingContentProvider()
    reviewer = RepairOnceContentReviewer()
    start = start_with_bounds(
        make_start(),
        replans_limit=1,
        token_budget=20_000,
        cost_budget_usd=2.0,
    )
    started = await _runner(provider, reviewer).start(_phase4_input(start=start))

    assert started.result.status == "awaiting_content_approval"
    assert started.result.state.bounds.replans_used == 1
    assert reviewer.calls == 2
    assert len(provider.prompts) == 2


@pytest.mark.asyncio
async def test_phase4_default_quality_reviewer_can_trigger_a_bounded_content_replan():
    provider = DuplicateOnceContentProvider()
    start = start_with_bounds(
        make_start(),
        replans_limit=1,
        token_budget=20_000,
        cost_budget_usd=2.0,
    )

    started = await _runner(provider).start(_phase4_input(start=start))

    assert started.result.status == "awaiting_content_approval"
    assert started.result.state.bounds.replans_used == 1
    assert len(provider.prompts) == 2


@pytest.mark.asyncio
async def test_phase4_exhausted_bounds_fail_before_provider():
    provider = RecordingContentProvider()
    start = start_with_bounds(
        make_start(),
        deadline_at="2020-01-01T00:00:00.000Z",
        token_budget=0,
        cost_budget_usd=0.0,
    )

    result = await _runner(provider).start(_phase4_input(start=start))

    assert result.result.status == "failed"
    assert result.result.error is not None
    assert result.result.error.code == "ORCHESTRATION_BUDGET_EXCEEDED"
    assert provider.prompts == []


@pytest.mark.asyncio
async def test_phase4_positive_budget_is_enforced_before_provider_call():
    provider = RecordingContentProvider()
    start = start_with_bounds(
        make_start(),
        token_budget=1,
        cost_budget_usd=0.000001,
    )

    result = await _runner(provider).start(_phase4_input(start=start))

    assert result.result.status == "failed"
    assert result.result.error is not None
    assert result.result.error.code == "ORCHESTRATION_BUDGET_EXCEEDED"
    assert provider.prompts == []
