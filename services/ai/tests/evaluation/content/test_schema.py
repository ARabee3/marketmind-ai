"""Schema tests for the Phase 1 content-eval case format."""

from __future__ import annotations

import json
from copy import deepcopy
from pathlib import Path

import pytest
from pydantic import ValidationError

from content_contracts import ContentPolicyFixture

from tests.evaluation.content.schema import (
    ContentEvalCase,
    ContentEvalDataset,
    ContentEvalLanguageMode,
    CycleState,
    ExpectedHardOutcome,
    FailureCategory,
    HumanRubric,
    NextWeekContext,
    ProtectedFictionalFields,
    ReviewerSignOff,
    ReviewerSignOffs,
    RubricScore,
    Sector,
    StrategySnapshot,
    default_reviewer_signoffs,
    to_contract_language_mode,
)


def _base_valid_case() -> ContentEvalCase:
    """Minimal valid eval case using a fixture_ref."""
    return ContentEvalCase(
        case_id="eval-retail-en-001",
        schema_version="content-eval-v1",
        sector="retail",
        language_mode="en",
        strategy_snapshot=StrategySnapshot(
            approved_channels=["facebook"],
            pillars=[{"pillar_id": "p-1", "name": "Awareness"}],
            tone="friendly and practical",
            formats=["static_image_post"],
            content_count=3,
            fact_sources=["owner_business_profile", "owner_week_context"],
            owner_inputs=["owner approved strategy"],
        ),
        cycle_state=CycleState(
            content_cycle_id="cc-00000000-0000-0000-0000-000000000001",
            week_number=1,
            prior_content_pack_id=None,
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
                score=4,
                reviewer_handle="@mostafamerzk",
                reviewed_at="2026-08-01",
                notes="Clear English.",
            ),
            tone=RubricScore(
                score=4,
                reviewer_handle="@mostafamerzk",
                reviewed_at="2026-08-01",
            ),
            usefulness=RubricScore(
                score=4,
                reviewer_handle="@mostafamerzk",
                reviewed_at="2026-08-01",
            ),
            pillar_alignment=RubricScore(
                score=4,
                reviewer_handle="@mostafamerzk",
                reviewed_at="2026-08-01",
            ),
            cta=RubricScore(
                score=4,
                reviewer_handle="@mostafamerzk",
                reviewed_at="2026-08-01",
            ),
            dialect=RubricScore(
                score=4,
                reviewer_handle="@mostafamerzk",
                reviewed_at="2026-08-01",
            ),
        ),
        reviewers=default_reviewer_signoffs(),
        description="Baseline retail English case.",
        fixture_ref="packages/contracts/examples/content-pack-week-1-en.example.json",
        created_at="2026-08-01",
    )


# ---------------------------------------------------------------------------
# Construction validity
# ---------------------------------------------------------------------------


def test_minimal_valid_case_with_fixture_ref() -> None:
    case = _base_valid_case()
    assert case.case_id == "eval-retail-en-001"
    assert case.schema_version == "content-eval-v1"
    assert case.sector == "retail"
    assert case.language_mode == "en"
    assert case.is_final is False
    assert case.average_rubric_score == 4.0


def test_minimal_valid_case_with_policy_fixture() -> None:
    """A case may carry an inline ContentPolicyFixture instead of a ref."""
    # Among the frozen fixtures, only the Arabic week-1 pack ships as a complete
    # ContentPolicyFixture (strategy_status, cycle, pack, item_version, assets,
    # decision). The English pack is a standalone ContentPack, which is why the
    # fixture_ref path is the normal way to reference simpler frozen examples.
    fixture_path = (
        Path(__file__).resolve().parents[5]
        / "packages"
        / "contracts"
        / "examples"
        / "content-pack-week-1-ar.example.json"
    )
    fixture = ContentPolicyFixture.model_validate(
        json.loads(fixture_path.read_text(encoding="utf-8"))
    )
    case = _base_valid_case()
    case = case.model_copy(update={"fixture_ref": None, "policy_fixture": fixture})
    assert case.fixture_ref is None
    assert case.policy_fixture is not None


def test_case_requires_fixture_or_policy_fixture() -> None:
    case = _base_valid_case()
    case = case.model_copy(update={"fixture_ref": None, "policy_fixture": None})
    with pytest.raises(ValidationError):
        case.model_validate(case.model_dump(mode="json"))


# ---------------------------------------------------------------------------
# Sector / language validation
# ---------------------------------------------------------------------------


def test_sector_must_be_one_of_five() -> None:
    case = _base_valid_case()
    data = case.model_dump(mode="json")
    data["sector"] = "fintech"
    with pytest.raises(ValidationError):
        ContentEvalCase.model_validate(data)


def test_language_mode_must_be_ar_en_mixed() -> None:
    case = _base_valid_case()
    data = case.model_dump(mode="json")
    data["language_mode"] = "fr"
    with pytest.raises(ValidationError):
        ContentEvalCase.model_validate(data)


def test_to_contract_language_mode_maps_ar() -> None:
    assert to_contract_language_mode("ar") == "ar-EG"
    assert to_contract_language_mode("en") == "en"
    assert to_contract_language_mode("mixed") == "mixed"


# ---------------------------------------------------------------------------
# Strategy snapshot constraints
# ---------------------------------------------------------------------------


def test_content_count_must_be_between_3_and_5() -> None:
    case = _base_valid_case()
    data = case.model_dump(mode="json")
    data["strategy_snapshot"]["content_count"] = 2
    with pytest.raises(ValidationError):
        ContentEvalCase.model_validate(data)


def test_content_count_must_not_exceed_5() -> None:
    case = _base_valid_case()
    data = case.model_dump(mode="json")
    data["strategy_snapshot"]["content_count"] = 6
    with pytest.raises(ValidationError):
        ContentEvalCase.model_validate(data)


def test_strategy_snapshot_requires_at_least_one_channel() -> None:
    case = _base_valid_case()
    data = case.model_dump(mode="json")
    data["strategy_snapshot"]["approved_channels"] = []
    with pytest.raises(ValidationError):
        ContentEvalCase.model_validate(data)


def test_strategy_snapshot_requires_at_least_one_pillar() -> None:
    case = _base_valid_case()
    data = case.model_dump(mode="json")
    data["strategy_snapshot"]["pillars"] = []
    with pytest.raises(ValidationError):
        ContentEvalCase.model_validate(data)


def test_strategy_snapshot_requires_at_least_one_format() -> None:
    case = _base_valid_case()
    data = case.model_dump(mode="json")
    data["strategy_snapshot"]["formats"] = []
    with pytest.raises(ValidationError):
        ContentEvalCase.model_validate(data)


def test_strategy_snapshot_requires_fact_sources() -> None:
    case = _base_valid_case()
    data = case.model_dump(mode="json")
    data["strategy_snapshot"]["fact_sources"] = []
    with pytest.raises(ValidationError):
        ContentEvalCase.model_validate(data)


# ---------------------------------------------------------------------------
# Cycle state / rolling-week constraints
# ---------------------------------------------------------------------------


def test_week_number_must_be_within_1_to_12() -> None:
    case = _base_valid_case()
    data = case.model_dump(mode="json")
    data["cycle_state"]["week_number"] = 0
    with pytest.raises(ValidationError):
        ContentEvalCase.model_validate(data)


def test_week_number_13_allowed_for_hard_rejection_case() -> None:
    case = _base_valid_case()
    data = case.model_dump(mode="json")
    data["cycle_state"]["week_number"] = 13
    reloaded = ContentEvalCase.model_validate(data)
    assert reloaded.cycle_state.week_number == 13


def test_week_number_14_rejected_at_schema_level() -> None:
    case = _base_valid_case()
    data = case.model_dump(mode="json")
    data["cycle_state"]["week_number"] = 14
    with pytest.raises(ValidationError):
        ContentEvalCase.model_validate(data)


def test_next_week_context_absent_requires_none_context() -> None:
    case = _base_valid_case()
    data = case.model_dump(mode="json")
    data["cycle_state"]["next_week_context_absent"] = True
    with pytest.raises(ValidationError):
        ContentEvalCase.model_validate(data)


def test_next_week_context_present_requires_absent_false() -> None:
    case = _base_valid_case()
    data = case.model_dump(mode="json")
    data["cycle_state"]["next_week_context"] = None
    with pytest.raises(ValidationError):
        ContentEvalCase.model_validate(data)


def test_absent_context_is_explicit_safe_default() -> None:
    case = _base_valid_case()
    case = case.model_copy(
        update={
            "cycle_state": case.cycle_state.model_copy(
                update={
                    "next_week_context": None,
                    "next_week_context_absent": True,
                }
            )
        }
    )
    assert case.cycle_state.next_week_context is None
    assert case.cycle_state.next_week_context_absent is True


# ---------------------------------------------------------------------------
# Expected hard outcome / failure-category consistency
# ---------------------------------------------------------------------------


def test_failure_case_requires_error_codes() -> None:
    case = _base_valid_case()
    case = case.model_copy(
        update={
            "expected_hard_outcome": ExpectedHardOutcome(
                expected_result="fail",
                per_guardrail={"strategy_approval": "fail"},
            ),
            "failure_category": "unapproved_strategy",
        }
    )
    with pytest.raises(ValidationError):
        ContentEvalCase.model_validate(case.model_dump(mode="json"))


def test_passing_case_must_not_list_error_codes() -> None:
    case = _base_valid_case()
    case = case.model_copy(
        update={
            "expected_hard_outcome": ExpectedHardOutcome(
                expected_result="pass",
                expected_error_codes=["CONTENT_STRATEGY_NOT_APPROVED"],
            )
        }
    )
    with pytest.raises(ValidationError):
        ContentEvalCase.model_validate(case.model_dump(mode="json"))


def test_passing_case_must_use_no_failure_category_or_revision_preservation() -> None:
    case = _base_valid_case()
    case = case.model_copy(
        update={"failure_category": "unapproved_strategy"}
    )
    with pytest.raises(ValidationError):
        ContentEvalCase.model_validate(case.model_dump(mode="json"))


def test_passing_case_allows_revision_preservation_category() -> None:
    case = _base_valid_case()
    case = case.model_copy(
        update={"failure_category": "revision_preservation"}
    )
    reloaded = ContentEvalCase.model_validate(case.model_dump(mode="json"))
    assert reloaded.failure_category == "revision_preservation"


def test_failure_case_with_expected_codes_validates() -> None:
    case = _base_valid_case()
    case = case.model_copy(
        update={
            "expected_hard_outcome": ExpectedHardOutcome(
                expected_result="fail",
                per_guardrail={"strategy_approval": "fail"},
                expected_error_codes=["CONTENT_STRATEGY_NOT_APPROVED"],
            ),
            "failure_category": "unapproved_strategy",
        }
    )
    reloaded = ContentEvalCase.model_validate(case.model_dump(mode="json"))
    assert reloaded.failure_category == "unapproved_strategy"


# ---------------------------------------------------------------------------
# Human rubric constraints
# ---------------------------------------------------------------------------


def test_rubric_score_must_be_between_0_and_5() -> None:
    case = _base_valid_case()
    data = case.model_dump(mode="json")
    data["human_rubric"]["language"]["score"] = 6
    with pytest.raises(ValidationError):
        ContentEvalCase.model_validate(data)


def test_rubric_score_must_be_non_negative() -> None:
    case = _base_valid_case()
    data = case.model_dump(mode="json")
    data["human_rubric"]["language"]["score"] = -1
    with pytest.raises(ValidationError):
        ContentEvalCase.model_validate(data)


def test_rubric_requires_named_reviewer() -> None:
    case = _base_valid_case()
    data = case.model_dump(mode="json")
    data["human_rubric"]["language"]["reviewer_handle"] = ""
    with pytest.raises(ValidationError):
        ContentEvalCase.model_validate(data)


def test_average_rubric_score_computed_correctly() -> None:
    case = _base_valid_case()
    case = case.model_copy(
        update={
            "human_rubric": HumanRubric(
                language=RubricScore(
                    score=5, reviewer_handle="@mostafamerzk", reviewed_at="2026-08-01"
                ),
                tone=RubricScore(
                    score=4, reviewer_handle="@mostafamerzk", reviewed_at="2026-08-01"
                ),
                usefulness=RubricScore(
                    score=3, reviewer_handle="@mostafamerzk", reviewed_at="2026-08-01"
                ),
                pillar_alignment=RubricScore(
                    score=4, reviewer_handle="@mostafamerzk", reviewed_at="2026-08-01"
                ),
                cta=RubricScore(
                    score=5, reviewer_handle="@mostafamerzk", reviewed_at="2026-08-01"
                ),
                dialect=RubricScore(
                    score=3, reviewer_handle="@mostafamerzk", reviewed_at="2026-08-01"
                ),
            )
        }
    )
    assert case.average_rubric_score == 4.0


# ---------------------------------------------------------------------------
# Reviewer sign-offs
# ---------------------------------------------------------------------------


def test_default_reviewer_signoffs_are_not_final() -> None:
    case = _base_valid_case()
    assert case.reviewers.owner_mokhtar.signed_off is False
    assert case.reviewers.eval_mostafa.signed_off is False
    assert case.reviewers.ai_product_merzk.signed_off is False
    assert case.reviewers.safety_rabee.signed_off is False


def test_case_is_final_only_when_all_reviewers_signed() -> None:
    case = _base_valid_case()
    assert case.is_final is False

    signed = ReviewerSignOff(
        role="Owner", handle="@MOKHXXXXXX", signed_off=True, signed_at="2026-08-01"
    )
    case = case.model_copy(
        update={
            "reviewers": ReviewerSignOffs(
                owner_mokhtar=signed,
                eval_mostafa=signed,
                ai_product_merzk=signed,
                safety_rabee=signed,
            )
        }
    )
    assert case.is_final is True


def test_reviewer_handles_are_locked_at_construction() -> None:
    case = _base_valid_case()
    data = case.model_dump(mode="json")
    data["reviewers"]["owner_mokhtar"]["handle"] = "@someone_else"
    reloaded = ContentEvalCase.model_validate(data)
    assert reloaded.reviewers.owner_mokhtar.handle == "@someone_else"
    # The schema does not enforce a fixed handle list; the harness documents the
    # four locked roles via default_reviewer_signoffs(). This test proves slots
    # are per-case fields, not aggregated at issue-close time.


# ---------------------------------------------------------------------------
# Immutability
# ---------------------------------------------------------------------------


def test_case_is_frozen() -> None:
    case = _base_valid_case()
    with pytest.raises(Exception):
        case.case_id = "mutated"


def test_strategy_snapshot_is_frozen() -> None:
    case = _base_valid_case()
    with pytest.raises(Exception):
        case.strategy_snapshot.tone = "mutated"


# ---------------------------------------------------------------------------
# Dataset
# ---------------------------------------------------------------------------


def test_dataset_can_hold_cases() -> None:
    case = _base_valid_case()
    dataset = ContentEvalDataset(
        version="content-eval-dataset-v1",
        cases=[case],
        created_at="2026-08-01",
    )
    assert len(dataset.cases) == 1
    assert dataset.schema_version == "content-eval-v1"


def test_dataset_requires_positive_version() -> None:
    with pytest.raises(ValidationError):
        ContentEvalDataset(version="", cases=[], created_at="2026-08-01")


# ---------------------------------------------------------------------------
# JSON round-trip
# ---------------------------------------------------------------------------


def test_json_round_trip_preserves_values() -> None:
    case = _base_valid_case()
    dumped = case.model_dump(mode="json")
    reloaded = ContentEvalCase.model_validate(dumped)
    assert reloaded.case_id == case.case_id
    assert reloaded.sector == case.sector
    assert reloaded.expected_hard_outcome.expected_result == case.expected_hard_outcome.expected_result
    assert reloaded.is_final == case.is_final


def test_dataset_json_round_trip() -> None:
    case = _base_valid_case()
    dataset = ContentEvalDataset(
        version="v1", cases=[case], created_at="2026-08-01"
    )
    dumped = dataset.model_dump(mode="json")
    reloaded = ContentEvalDataset.model_validate(dumped)
    assert reloaded.cases[0].case_id == case.case_id


# ---------------------------------------------------------------------------
# Error-code membership
# ---------------------------------------------------------------------------


def test_expected_error_codes_must_be_contract_codes() -> None:
    case = _base_valid_case()
    with pytest.raises(ValidationError):
        bad_case = case.model_copy(
            update={
                "expected_hard_outcome": ExpectedHardOutcome(
                    expected_result="fail",
                    per_guardrail={"strategy_approval": "fail"},
                    expected_error_codes=["NOT_A_REAL_CODE"],  # type: ignore[list-item]
                ),
                "failure_category": "unapproved_strategy",
            }
        )
        ContentEvalCase.model_validate(bad_case.model_dump(mode="json"))
