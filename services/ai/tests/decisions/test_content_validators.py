"""Tests for plan-content validators."""

from __future__ import annotations

import pytest

from strategy_contracts import (
    ClaimSource,
    SourcedClaim,
    StrategyPlan,
    StrategyValidationIssue,
)

from app.decisions.content_validators import (
    validate_content_agent_leakage,
    validate_fact_assumption_labels,
    validate_plan_content,
    validate_publishing_execution_language,
    validate_required_sections,
)

from tests.decisions.fixtures.base import load_json


def _minimal_plan() -> StrategyPlan:
    return StrategyPlan.model_validate(load_json("strategy-plan.example.json"))


def _empty_claim(text: str = "", source: ClaimSource = "model_synthesis") -> SourcedClaim:
    return SourcedClaim(text=text, source=source, citation_ids=[])


def test_required_sections_detects_empty_executive_summary():
    plan = _minimal_plan()
    plan = plan.model_copy(update={"executive_summary": _empty_claim("")})
    issues = validate_required_sections(plan)
    assert any(issue.field == "executive_summary" for issue in issues)


def test_required_sections_passes_complete_fixture():
    plan = _minimal_plan()
    issues = validate_required_sections(plan)
    assert issues == []


def test_fact_assumption_labels_detects_missing_citation():
    plan = _minimal_plan()
    plan = plan.model_copy(
        update={
            "executive_summary": SourcedClaim(
                text="Fact text.",
                source="confirmed_fact",
                citation_ids=[],
            )
        }
    )
    issues = validate_fact_assumption_labels(plan)
    assert any(issue.field == "executive_summary" for issue in issues)


def test_fact_assumption_labels_detects_synthesis_number_without_hedge():
    plan = _minimal_plan()
    plan = plan.model_copy(
        update={
            "executive_summary": SourcedClaim(
                text="We expect 25% growth.",
                source="model_synthesis",
                citation_ids=[],
                confidence_note=None,
            )
        }
    )
    issues = validate_fact_assumption_labels(plan)
    assert any(issue.field == "executive_summary" for issue in issues)


def test_content_agent_leakage_detects_hashtag():
    plan = _minimal_plan()
    plan = plan.model_copy(
        update={
            "executive_summary": SourcedClaim(
                text="Use #KosharyCorner for all posts.",
                source="model_synthesis",
                citation_ids=[],
            )
        }
    )
    issues = validate_content_agent_leakage(plan)
    assert any(issue.field == "executive_summary" for issue in issues)


def test_content_agent_leakage_detects_caption_prefix():
    plan = _minimal_plan()
    plan = plan.model_copy(
        update={
            "executive_summary": SourcedClaim(
                text="Caption: best koshary in town.",
                source="model_synthesis",
                citation_ids=[],
            )
        }
    )
    issues = validate_content_agent_leakage(plan)
    assert any(issue.field == "executive_summary" for issue in issues)


def test_publishing_execution_language_detects_scheduled_publishing():
    plan = _minimal_plan()
    plan = plan.model_copy(
        update={
            "executive_summary": SourcedClaim(
                text="The campaign is scheduled for publishing next week.",
                source="model_synthesis",
                citation_ids=[],
            )
        }
    )
    issues = validate_publishing_execution_language(plan)
    assert any(issue.field == "executive_summary" for issue in issues)


def test_validate_plan_content_merges_all_issue_lists():
    plan = _minimal_plan()
    plan = plan.model_copy(
        update={
            "executive_summary": SourcedClaim(
                text="",
                source="confirmed_fact",
                citation_ids=[],
            )
        }
    )
    issues = validate_plan_content(plan)
    assert len(issues) >= 2


def test_issues_use_contract_codes():
    plan = _minimal_plan()
    plan = plan.model_copy(
        update={
            "executive_summary": SourcedClaim(
                text="",
                source="confirmed_fact",
                citation_ids=[],
            )
        }
    )
    issues = validate_plan_content(plan)
    for issue in issues:
        assert isinstance(issue, StrategyValidationIssue)
        assert issue.code == "STRATEGY_RULE_VIOLATION"
