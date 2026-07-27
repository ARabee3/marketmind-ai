from __future__ import annotations

import pytest
from strategy_contracts import StrategyPlan, RetrievedKnowledgePack
from tests.evaluation.runner.grounding_checker import check_strategy_grounding
from tests.strategy.fixtures import default_plan, default_retrieval_pack, default_business_profile, default_brief


@pytest.mark.eval_smoke
def test_no_raw_marketingskills_files_in_retrieval_pack() -> None:
    """Verify retrieval pack contains only MarketMind reviewed playbooks and no raw external skill files."""
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
    """Verify citations resolve ONLY to approved MarketMind knowledge entries or verified benchmarks."""
    plan = default_plan()
    pack = default_retrieval_pack()

    grounding_result = check_strategy_grounding(plan, pack)
    assert grounding_result.source_enforcement_passed, f"Source enforcement failed: {grounding_result.raw_skill_leakage_found}"
    assert len(grounding_result.raw_skill_leakage_found) == 0


@pytest.mark.eval_smoke
def test_rejection_of_unlocalized_saas_assumptions() -> None:
    """Verify plans for local SMEs reject unlocalized SaaS/B2B assumptions like ARR, CAC, enterprise budgets."""
    plan = default_plan()
    plan_json = plan.model_dump_json().lower()

    unwanted_saas_terms = ["arr", "annual recurring revenue", "cac payback", "linkedin-first", "series a funding"]
    found_terms = [term for term in unwanted_saas_terms if term in plan_json]

    assert len(found_terms) == 0, f"Unlocalized SaaS/B2B terms found in SME plan: {found_terms}"


@pytest.mark.eval_smoke
def test_egyptian_sme_wording_for_arabic_and_mixed_cases() -> None:
    """Verify Arabic-first and mixed-language cases use Egyptian SME wording."""
    plan = default_plan()
    summary = plan.executive_summary.text
    assert len(summary) > 0
    # Verify no raw unlocalized SaaS translation jargon
    assert "سلسلة أ تمويل" not in summary
    assert "العائد المتكرر السنوي" not in summary
