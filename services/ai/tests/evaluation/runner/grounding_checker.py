from __future__ import annotations

from typing import Any
from pydantic import BaseModel, Field
from strategy_contracts import StrategyPlan, RetrievedKnowledgePack


class GroundingCheckResult(BaseModel):
    plan_id: str
    citation_integrity_passed: bool
    retrieval_resolution_passed: bool
    benchmark_validation_passed: bool
    source_enforcement_passed: bool
    all_grounding_passed: bool
    total_sourced_claims: int = 0
    valid_citations_count: int = 0
    unresolved_citation_ids: list[str] = Field(default_factory=list)
    unresolved_chunk_ids: list[str] = Field(default_factory=list)
    ungrounded_benchmark_kpis: list[str] = Field(default_factory=list)
    incompatible_benchmark_kpis: list[str] = Field(default_factory=list)
    raw_skill_leakage_found: list[str] = Field(default_factory=list)
    diagnostics: list[str] = Field(default_factory=list)


def check_strategy_grounding(
    plan: StrategyPlan,
    retrieval_pack: RetrievedKnowledgePack,
) -> GroundingCheckResult:
    """Deterministically check grounding of a StrategyPlan against its RetrievedKnowledgePack.

    Checks:
    1. Citation integrity — every claim citation_id exists in plan.citations.
    2. Retrieval resolution — every plan citation chunk_id is in the retrieved pack.
    3. Benchmark compatibility — verified_benchmark_range KPIs must cite a pack
       item with evidence_tier == "verified_benchmark".
    4. Source enforcement — citations must not reference raw skill leakage URLs.
    """
    diagnostics: list[str] = []

    # ── 1. Collect all citations in the plan ──────────────────────────────────
    plan_citations_by_id = {str(c.citation_id): c for c in plan.citations}
    retrieved_chunk_ids = {str(item.chunk_id) for item in retrieval_pack.items}

    # Build chunk_id → evidence_tier lookup for benchmark compatibility checks.
    pack_tier_by_chunk: dict[str, str] = {
        str(item.chunk_id): str(
            getattr(item, "evidence_tier", "") or getattr(item, "source_quality", "")
        )
        for item in retrieval_pack.items
    }

    # ── 2. SourcedClaims citation integrity ───────────────────────────────────
    total_claims = 0
    valid_citations_count = 0
    unresolved_citation_ids: set[str] = set()

    def inspect_claim(claim: Any, context_label: str) -> None:
        nonlocal total_claims, valid_citations_count
        if hasattr(claim, "citation_ids") and claim.citation_ids:
            total_claims += 1
            for cit_id_val in claim.citation_ids:
                cit_id_str = str(cit_id_val)
                if cit_id_str in plan_citations_by_id:
                    valid_citations_count += 1
                else:
                    unresolved_citation_ids.add(cit_id_str)
                    diagnostics.append(
                        f"[{context_label}] Claim cited '{cit_id_str}' which is missing in plan.citations"
                    )

    sourced_claim_fields = [
        ("executive_summary", getattr(plan, "executive_summary", None)),
        ("situation_diagnosis", getattr(plan, "situation_diagnosis", None)),
        ("target_audience", getattr(plan, "target_audience", None)),
        ("positioning", getattr(plan, "positioning", None)),
        ("tone", getattr(plan, "tone", None)),
    ]
    for field_name, claim_obj in sourced_claim_fields:
        if claim_obj:
            inspect_claim(claim_obj, field_name)

    if hasattr(plan, "assumptions") and plan.assumptions:
        for idx, claim_obj in enumerate(plan.assumptions):
            inspect_claim(claim_obj, f"assumptions[{idx}]")

    if hasattr(plan, "risks") and plan.risks:
        for idx, claim_obj in enumerate(plan.risks):
            inspect_claim(claim_obj, f"risks[{idx}]")

    citation_integrity_passed = len(unresolved_citation_ids) == 0

    # ── 3. Retrieval resolution & raw skill leakage ───────────────────────────
    unresolved_chunk_ids: set[str] = set()
    raw_skill_leakage: set[str] = set()

    for cit_id_str, citation in plan_citations_by_id.items():
        chunk_id_str = str(citation.chunk_id)
        if chunk_id_str not in retrieved_chunk_ids:
            unresolved_chunk_ids.add(chunk_id_str)
            diagnostics.append(
                f"Citation '{cit_id_str}' references chunk_id '{chunk_id_str}' "
                f"not in retrieved_knowledge_pack"
            )

        source_ref_str = str(citation.title) + " " + str(citation.entry_id)
        if (
            "marketingskills" in source_ref_str.lower()
            or "github.com/vercel-labs" in source_ref_str.lower()
        ):
            raw_skill_leakage.add(source_ref_str)
            diagnostics.append(
                f"Raw external skill leakage detected in citation '{cit_id_str}': {source_ref_str}"
            )

    retrieval_resolution_passed = len(unresolved_chunk_ids) == 0
    source_enforcement_passed = len(raw_skill_leakage) == 0

    # ── 4. Benchmark citation compatibility ───────────────────────────────────
    # A KPI with target_mode == "verified_benchmark_range" must:
    # (a) Have a benchmark_citation_id that exists in plan.citations, AND
    # (b) That citation's chunk_id must resolve to a pack item whose
    #     evidence_tier is "verified_benchmark".
    ungrounded_benchmarks: list[str] = []
    incompatible_benchmarks: list[str] = []

    for kpi in plan.kpi_targets:
        if str(getattr(kpi, "target_mode", "")) == "verified_benchmark_range":
            benchmark_cit_id = (
                str(kpi.benchmark_citation_id) if kpi.benchmark_citation_id else None
            )
            if not benchmark_cit_id or benchmark_cit_id not in plan_citations_by_id:
                ungrounded_benchmarks.append(kpi.metric)
                diagnostics.append(
                    f"KPI '{kpi.metric}' uses verified_benchmark_range but lacks valid benchmark_citation_id"
                )
            else:
                cit = plan_citations_by_id[benchmark_cit_id]
                chunk_str = str(cit.chunk_id)
                tier = pack_tier_by_chunk.get(chunk_str, "")
                # Only flag incompatibility when the pack item is present but its
                # tier is explicitly not a benchmark tier.
                if tier and "verified_benchmark" not in tier:
                    incompatible_benchmarks.append(kpi.metric)
                    diagnostics.append(
                        f"KPI '{kpi.metric}' benchmark citation '{benchmark_cit_id}' resolves to "
                        f"chunk '{chunk_str}' with incompatible evidence_tier='{tier}' "
                        f"(expected 'verified_benchmark')"
                    )

    benchmark_validation_passed = (
        len(ungrounded_benchmarks) == 0 and len(incompatible_benchmarks) == 0
    )

    # ── Final verdict ─────────────────────────────────────────────────────────
    all_passed = (
        citation_integrity_passed
        and retrieval_resolution_passed
        and benchmark_validation_passed
        and source_enforcement_passed
    )

    return GroundingCheckResult(
        plan_id=str(plan.id),
        citation_integrity_passed=citation_integrity_passed,
        retrieval_resolution_passed=retrieval_resolution_passed,
        benchmark_validation_passed=benchmark_validation_passed,
        source_enforcement_passed=source_enforcement_passed,
        all_grounding_passed=all_passed,
        total_sourced_claims=total_claims,
        valid_citations_count=valid_citations_count,
        unresolved_citation_ids=sorted(unresolved_citation_ids),
        unresolved_chunk_ids=sorted(unresolved_chunk_ids),
        ungrounded_benchmark_kpis=ungrounded_benchmarks,
        incompatible_benchmark_kpis=incompatible_benchmarks,
        raw_skill_leakage_found=sorted(raw_skill_leakage),
        diagnostics=diagnostics,
    )
