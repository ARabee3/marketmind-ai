from __future__ import annotations

import re

import pytest
from strategy_contracts import StrategyPlan, RetrievedKnowledgePack
from tests.evaluation.runner.grounding_checker import check_strategy_grounding
from tests.strategy.fixtures import default_plan, default_retrieval_pack, default_business_profile, default_brief

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
def test_adaptation_across_language_modes(eval_dataset) -> None:
    """Run adaptation checks across all dataset cases grouped by language mode."""
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

    all_issues: dict[str, dict[str, list[str]]] = {}
    for case in eval_dataset.cases:
        plan = default_plan()
        issues = _check_plan_text(plan)
        all_issues[case.id] = issues

    total_violations = sum(len(v) for issues in all_issues.values() for v in issues.values())
    assert total_violations == 0, (
        f"Adaptation issues found across dataset:\n"
        + "\n".join(
            f"  {cid}: {issues}"
            for cid, issues in all_issues.items()
            if any(v for v in issues.values())
        )
    )
