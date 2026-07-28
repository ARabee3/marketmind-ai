from __future__ import annotations

from enum import Enum
import re

import pytest
from app.core.config import Settings
from strategy_contracts import StrategyPlan
from tests.evaluation.runner.grounding_checker import check_strategy_grounding
from tests.evaluation.runner.generation_runner import (
    GenerationEvalRunner,
    make_eval_brief,
)
from tests.strategy.fixtures import default_plan, default_retrieval_pack, default_business_profile

UNWANTED_SAAS_TERMS = ["arr", "annual recurring revenue", "cac payback", "linkedin-first", "series a funding"]
ARABIC_SAAS_JARGON = ["سلسلة أ تمويل", "العائد المتكرر السنوي"]

LOCALIZATION_PATTERNS: list[tuple[str, re.Pattern]] = [
    ("content_agent_leakage", re.compile(r"(?:\bCaption\s*:|\bScript\s*:|\bPost\s+\d+\s*:)", re.IGNORECASE)),
    ("execution_language", re.compile(r"\bscheduled\s+for\s+publishing\b", re.IGNORECASE)),
    ("paid_tactic", re.compile(r"\bbudget\s+has\s+been\s+spent\b", re.IGNORECASE)),
]


def _check_plan_text(plan: StrategyPlan) -> dict[str, list[str]]:
    issues: dict[str, list[str]] = {k: [] for k, _ in LOCALIZATION_PATTERNS}
    plan_json = plan.model_dump_json().lower()

    for term in UNWANTED_SAAS_TERMS:
        if term in plan_json:
            issues.setdefault("unlocalized_saas", []).append(term)

    summary = plan.executive_summary.text
    for term in ARABIC_SAAS_JARGON:
        if term in summary:
            issues.setdefault("arabic_saas_jargon", []).append(term)

    for label, pattern in LOCALIZATION_PATTERNS:
        for field_name in ("executive_summary", "situation_diagnosis", "target_audience", "positioning", "tone"):
            text = str(getattr(getattr(plan, field_name, None), "text", ""))
            if pattern.search(text):
                issues[label].append(field_name)

    return issues


def _enum_value(value: Enum | str) -> str:
    return str(getattr(value, "value", value))


@pytest.mark.eval_smoke
def test_no_raw_marketingskills_files_in_retrieval_pack() -> None:
    pack = default_retrieval_pack()
    for item in pack.items:
        title = item.title.lower()
        chunk_id = item.chunk_id.lower()
        entry_id = item.entry_id.lower()

        assert "marketingskills" not in title, f"Raw skill file retrieved in pack: {title}"
        assert "marketingskills" not in chunk_id, f"Raw skill chunk_id found: {chunk_id}"
        assert "marketingskills" not in entry_id, f"Raw skill entry_id found: {entry_id}"
        assert "github.com/vercel-labs" not in title, f"External repo link found in title: {title}"


@pytest.mark.eval_smoke
def test_citations_resolve_only_to_approved_marketmind_entries() -> None:
    plan = default_plan()
    pack = default_retrieval_pack()

    grounding_result = check_strategy_grounding(plan, pack)
    assert grounding_result.source_enforcement_passed, f"Source enforcement failed: {grounding_result.raw_skill_leakage_found}"
    assert len(grounding_result.raw_skill_leakage_found) == 0


@pytest.mark.eval_smoke
def test_rejection_of_unlocalized_saas_assumptions() -> None:
    plan = default_plan()
    issues = _check_plan_text(plan)
    found = issues.get("unlocalized_saas", [])
    assert len(found) == 0, f"Unlocalized SaaS/B2B terms found in SME plan: {found}"


@pytest.mark.eval_smoke
def test_egyptian_sme_wording_for_arabic_and_mixed_cases() -> None:
    plan = default_plan()
    issues = _check_plan_text(plan)
    found = issues.get("arabic_saas_jargon", [])
    assert len(found) == 0, f"Unlocalized Arabic SaaS jargon found: {found}"


@pytest.mark.eval_smoke
def test_no_localization_or_pattern_leakage() -> None:
    plan = default_plan()
    issues = _check_plan_text(plan)
    leakage = issues.get("content_agent_leakage", [])
    exec_lang = issues.get("execution_language", [])
    paid_tactics = issues.get("paid_tactic", [])
    assert len(leakage) == 0, f"Content agent leakage detected in fields: {leakage}"
    assert len(exec_lang) == 0, f"Execution language detected in fields: {exec_lang}"
    assert len(paid_tactics) == 0, f"Paid tactic patterns detected: {paid_tactics}"


@pytest.mark.eval_full
@pytest.mark.asyncio
async def test_adaptation_across_language_modes(eval_dataset) -> None:
    locales = {"ar-EG": [], "en": [], "mixed": []}
    for case in eval_dataset.cases:
        loc = case.query_input.locale
        if loc in locales:
            locales[loc].append(case.id)

    report_lines = []
    for locale_label, case_ids in sorted(locales.items()):
        report_lines.append(f"  {locale_label}: {len(case_ids)} cases ({', '.join(case_ids)})")

    assert len(locales["ar-EG"]) > 0, f"No Arabic cases in dataset: {report_lines}"
    assert len(locales["en"]) > 0, f"No English cases in dataset: {report_lines}"
    assert len(locales["mixed"]) > 0, f"No mixed cases in dataset: {report_lines}"

    runner = GenerationEvalRunner(Settings(ai_provider_mode="mock"))
    profile = default_business_profile()
    pack = default_retrieval_pack()
    all_issues: dict[str, dict[str, list[str]]] = {}
    summary_by_case: dict[str, str] = {}
    default_summary = default_plan().executive_summary.text.lower()

    for case in eval_dataset.cases:
        brief = make_eval_brief(case)
        case_profile = profile.model_copy(
            update={
                "id": brief.business_profile_version.business_profile_version_id,
                "version": brief.business_profile_version.version,
            }
        )
        case_pack_data = pack.model_dump(mode="json")
        case_pack_data["brief_id"] = str(brief.id)
        case_pack_data["profile_version_id"] = str(case_profile.id)
        case_pack_data["query_context"] = case.query_input.model_dump()
        case_pack = type(pack).model_validate(case_pack_data)
        plan = (await runner.generate_single(case_profile, brief, case_pack)).plan
        issues = _check_plan_text(plan)
        summary_text = plan.executive_summary.text.lower()
        expected_terms = [
            case.query_input.business_type.lower(),
            case.query_input.objective.lower(),
            case.query_input.locale.lower(),
        ]
        missing_terms = [term for term in expected_terms if term not in summary_text]
        if missing_terms:
            issues.setdefault("missing_case_context", []).extend(missing_terms)
        if summary_text == default_summary:
            issues.setdefault("unchanged_fixture_summary", []).append("executive_summary")
        if _enum_value(plan.primary_objective) != case.query_input.objective:
            issues.setdefault("wrong_objective", []).append(_enum_value(plan.primary_objective))
        if _enum_value(plan.plan_language) != case.query_input.locale:
            issues.setdefault("wrong_language", []).append(_enum_value(plan.plan_language))
        if _enum_value(plan.budget_mode) != case.query_input.budget_mode:
            issues.setdefault("wrong_budget_mode", []).append(_enum_value(plan.budget_mode))
        all_issues[case.id] = issues
        summary_by_case[case.id] = summary_text

    total_violations = sum(len(v) for issues in all_issues.values() for v in issues.values())
    assert len(set(summary_by_case.values())) > 10
    assert total_violations == 0, (
        f"Adaptation issues found across dataset:\n"
        + "\n".join(
            f"  {cid}: {issues}"
            for cid, issues in all_issues.items()
            if any(v for v in issues.values())
        )
    )
