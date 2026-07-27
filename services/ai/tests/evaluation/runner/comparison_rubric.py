from __future__ import annotations

from pydantic import BaseModel, Field
from strategy_contracts import StrategyPlan, RetrievedKnowledgePack
from tests.evaluation.runner.grounding_checker import check_strategy_grounding


class ComparisonRubricResult(BaseModel):
    case_id: str
    case_language: str
    case_sector: str
    rag_citations_count: int
    no_rag_citations_count: int
    rag_grounding_passed: bool
    no_rag_grounding_passed: bool
    rag_sourced_claims: int
    no_rag_sourced_claims: int
    grounding_improvement_score: float  # Score from 0.0 to 1.0 showing improvement of RAG over no-RAG
    has_more_grounded_claims: bool
    summary: str
    rag_diagnostics: list[str] = Field(default_factory=list)
    no_rag_diagnostics: list[str] = Field(default_factory=list)


def evaluate_rag_vs_norag(
    case_id: str,
    rag_plan: StrategyPlan,
    rag_pack: RetrievedKnowledgePack,
    no_rag_plan: StrategyPlan,
    no_rag_pack: RetrievedKnowledgePack,
    case_language: str = "unknown",
    case_sector: str = "unknown",
) -> ComparisonRubricResult:
    """Evaluate grounding, traceability, and metric improvements of RAG over No-RAG runs."""
    rag_check = check_strategy_grounding(rag_plan, rag_pack)
    no_rag_check = check_strategy_grounding(no_rag_plan, no_rag_pack)

    rag_citations = len(rag_plan.citations)
    no_rag_citations = len(no_rag_plan.citations)
    rag_sourced_claims = rag_check.total_sourced_claims
    no_rag_sourced_claims = no_rag_check.total_sourced_claims

    has_more_grounded = (
        rag_citations >= no_rag_citations
        and rag_check.valid_citations_count >= no_rag_check.valid_citations_count
    )

    # Calculate improvement score (0 to 1) based on citation depth and grounding validity.
    # The score should reflect how much RAG helps over no-RAG for this specific case.
    base_score = 0.5 if rag_check.all_grounding_passed else 0.3

    if no_rag_citations == 0 and rag_citations > 0:
        # RAG added citations where no-RAG had none: strong improvement.
        base_score = min(1.0, base_score + 0.4)
    elif rag_check.valid_citations_count > no_rag_check.valid_citations_count:
        # RAG citations are more valid than no-RAG: moderate improvement.
        base_score = min(1.0, base_score + 0.2)

    if rag_check.raw_skill_leakage_found or no_rag_check.raw_skill_leakage_found:
        # Penalize if either plan has uncontrolled external leakage.
        if not rag_check.raw_skill_leakage_found and no_rag_check.raw_skill_leakage_found:
            base_score = min(1.0, base_score + 0.1)

    summary = (
        f"Case '{case_id}' [{case_language}/{case_sector}]: "
        f"RAG plan cited {rag_citations} sources ({rag_check.valid_citations_count} valid, "
        f"{rag_sourced_claims} claims) vs No-RAG plan cited {no_rag_citations} sources "
        f"({no_rag_check.valid_citations_count} valid, {no_rag_sourced_claims} claims). "
        f"RAG grounding={'PASS' if rag_check.all_grounding_passed else 'FAIL'}. "
        f"Improvement={round(base_score, 2)}."
    )

    return ComparisonRubricResult(
        case_id=case_id,
        case_language=case_language,
        case_sector=case_sector,
        rag_citations_count=rag_citations,
        no_rag_citations_count=no_rag_citations,
        rag_sourced_claims=rag_sourced_claims,
        no_rag_sourced_claims=no_rag_sourced_claims,
        rag_grounding_passed=rag_check.all_grounding_passed,
        no_rag_grounding_passed=no_rag_check.all_grounding_passed,
        grounding_improvement_score=round(base_score, 2),
        has_more_grounded_claims=has_more_grounded,
        summary=summary,
        rag_diagnostics=rag_check.diagnostics,
        no_rag_diagnostics=no_rag_check.diagnostics,
    )
