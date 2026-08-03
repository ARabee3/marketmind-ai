"""Phase 7 reviewer sign-off tracker tests."""

from __future__ import annotations

from tests.evaluation.content.schema import (
    ContentEvalCase,
    CycleState,
    ExpectedHardOutcome,
    HumanRubric,
    NextWeekContext,
    ProtectedFictionalFields,
    ReviewerSignOff,
    ReviewerSignOffs,
    RubricScore,
    StrategySnapshot,
)
from tests.evaluation.content.review_status import (
    build_review_status_report,
    format_review_status_summary,
)


def _make_case(
    *,
    case_id: str = "test-case",
    owner_signed: bool = False,
    eval_signed: bool = False,
    ai_signed: bool = False,
    safety_signed: bool = False,
) -> ContentEvalCase:
    """Build a minimal ContentEvalCase with controlled reviewer state."""
    signoffs = ReviewerSignOffs(
        owner_mokhtar=ReviewerSignOff(
            role="Owner", handle="@MOKHXXXXXX", signed_off=owner_signed
        ),
        eval_mostafa=ReviewerSignOff(
            role="Eval reviewer",
            handle="@MostafaAhmed22",
            signed_off=eval_signed,
        ),
        ai_product_merzk=ReviewerSignOff(
            role="AI/product reviewer",
            handle="@mostafamerzk",
            signed_off=ai_signed,
        ),
        safety_rabee=ReviewerSignOff(
            role="Safety reviewer",
            handle="@ARabee3",
            signed_off=safety_signed,
        ),
    )
    return ContentEvalCase(
        case_id=case_id,
        schema_version="content-eval-v1",
        sector="retail",
        language_mode="en",
        strategy_snapshot=StrategySnapshot(
            approved_channels=["facebook"],
            pillars=[{"pillar_id": "p-1", "name": "Awareness"}],
            tone="friendly",
            formats=["static_image_post"],
            content_count=3,
            fact_sources=["owner_business_profile", "owner_week_context"],
            owner_inputs=["owner approved strategy"],
        ),
        cycle_state=CycleState(
            content_cycle_id="cc-00000000-0000-0000-0000-000000000001",
            week_number=1,
            next_week_context=NextWeekContext(
                promotion_mode="none",
                cta_destination_type="phone",
                cta_destination_value="+201000000000",
            ),
            next_week_context_absent=False,
        ),
        protected_fictional_fields=ProtectedFictionalFields(
            business_name="Fictional Retail Co",
            owner_name="Mokhtar Fictional",
            handles=["@fictionalretail"],
            addresses=["123 Fictional St, Cairo"],
            prices=["EGP 100"],
            offer_terms=["10% off fictional items"],
            owner_text="Owner says: use the fictional slogan.",
        ),
        expected_hard_outcome=ExpectedHardOutcome(
            expected_result="pass",
            per_guardrail={"strategy_approval": "pass", "item_count": "pass"},
        ),
        failure_category="no_failure",
        human_rubric=HumanRubric(
            language=RubricScore(
                score=4, reviewer_handle="@mostafamerzk", reviewed_at="2026-08-01"
            ),
            tone=RubricScore(
                score=4, reviewer_handle="@mostafamerzk", reviewed_at="2026-08-01"
            ),
            usefulness=RubricScore(
                score=4, reviewer_handle="@mostafamerzk", reviewed_at="2026-08-01"
            ),
            pillar_alignment=RubricScore(
                score=4, reviewer_handle="@mostafamerzk", reviewed_at="2026-08-01"
            ),
            cta=RubricScore(
                score=4, reviewer_handle="@mostafamerzk", reviewed_at="2026-08-01"
            ),
        ),
        reviewers=signoffs,
        description="Minimal case for review status tests.",
        fixture_ref="packages/contracts/examples/content-pack-week-1-en.example.json",
        created_at="2026-08-01",
    )


def test_case_report_all_pending() -> None:
    case = _make_case()
    report = build_review_status_report([case])
    assert report.total_cases == 1
    assert report.final_cases == 0
    assert report.pending_cases == 1
    per_case = report.per_case[0]
    assert per_case.pending_roles == [
        "owner_mokhtar",
        "eval_mostafa",
        "ai_product_merzk",
        "safety_rabee",
    ]
    assert per_case.final is False


def test_case_report_all_signed() -> None:
    case = _make_case(
        owner_signed=True,
        eval_signed=True,
        ai_signed=True,
        safety_signed=True,
    )
    report = build_review_status_report([case])
    assert report.final_cases == 1
    assert report.pending_cases == 0
    per_case = report.per_case[0]
    assert per_case.pending_roles == []
    assert per_case.signed_roles == [
        "owner_mokhtar",
        "eval_mostafa",
        "ai_product_merzk",
        "safety_rabee",
    ]
    assert per_case.final is True


def test_pending_by_role_counts() -> None:
    case1 = _make_case(owner_signed=True)
    case2 = _make_case(owner_signed=True, eval_signed=True)
    report = build_review_status_report([case1, case2])
    assert report.pending_by_role["owner_mokhtar"] == 0
    assert report.pending_by_role["eval_mostafa"] == 1
    assert report.pending_by_role["ai_product_merzk"] == 2
    assert report.pending_by_role["safety_rabee"] == 2


def test_report_json_round_trip() -> None:
    case = _make_case(owner_signed=True)
    report = build_review_status_report([case])
    data = report.to_dict()
    assert data["total_cases"] == 1
    assert data["pending_cases"] == 1
    assert data["per_case"][0]["case_id"] == "test-case"


def test_format_summary_shows_pending_cases() -> None:
    case = _make_case(case_id="case-a", owner_signed=True)
    report = build_review_status_report([case])
    summary = format_review_status_summary(report)
    assert "case-a" in summary
    assert "eval_mostafa, ai_product_merzk, safety_rabee" in summary


def test_format_summary_shows_none_when_all_final() -> None:
    case = _make_case(
        owner_signed=True,
        eval_signed=True,
        ai_signed=True,
        safety_signed=True,
    )
    report = build_review_status_report([case])
    summary = format_review_status_summary(report)
    assert "Pending cases:" in summary
    assert "None" in summary


def test_real_dataset_report() -> None:
    """The real generated datasets should produce a report without errors."""
    report = build_review_status_report()
    assert report.total_cases > 0
    assert report.pending_cases == report.total_cases
    assert report.final_cases == 0
    assert all(
        report.pending_by_role[role] == report.total_cases
        for role in report.pending_by_role
    )
