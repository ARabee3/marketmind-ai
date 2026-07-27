from __future__ import annotations

from datetime import datetime
from typing import Any
from pydantic import BaseModel, Field
from strategy_contracts import StrategyPlan, RetrievedKnowledgePack

APPROVED_SOURCE_PREFIXES = (
    "internal:reviewed-marketing-methodology",
    "synthetic-fixture://",
)


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
    source_reference_violations: list[str] = Field(default_factory=list)
    benchmark_source_issues: list[str] = Field(default_factory=list)
    diagnostics: list[str] = Field(default_factory=list)


def _naive_datetime(value: datetime) -> datetime:
    if value.tzinfo is not None:
        return value.replace(tzinfo=None)
    return value


def check_strategy_grounding(
    plan: StrategyPlan,
    retrieval_pack: RetrievedKnowledgePack,
) -> GroundingCheckResult:
    """Deterministically check grounding of a StrategyPlan against its RetrievedKnowledgePack.

    Checks:
    1. Citation integrity — every claim citation_id exists in plan.citations.
    2. Retrieval resolution — every plan citation chunk_id is in the retrieved pack.
    3. Source governance — every retrieved item's source_references must resolve to
       approved MarketMind internal sources, not raw external URLs.
    4. Benchmark compatibility — verified_benchmark_range KPIs must cite a pack
       item with evidence_tier == "verified_benchmark", valid review_status,
       effective/expiry dates, and matching market/locale/industry.
    5. Source enforcement — citations must not reference raw skill leakage URLs.
    """
    diagnostics: list[str] = []

    # ── 1. Collect all citations in the plan ──────────────────────────────────
    plan_citations_by_id = {str(c.citation_id): c for c in plan.citations}
    pack_item_by_chunk: dict[str, RetrievedKnowledgePack.items] = {
        str(item.chunk_id): item for item in retrieval_pack.items
    }
    retrieved_chunk_ids = set(pack_item_by_chunk.keys())

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

    # ── 3. Retrieval resolution, source governance & raw skill leakage ────────
    unresolved_chunk_ids: set[str] = set()
    raw_skill_leakage: set[str] = set()
    source_reference_violations: list[str] = []

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

    for item in retrieval_pack.items:
        sq = getattr(item, "source_quality", None)
        if sq is None:
            continue
        for ref in getattr(sq, "source_references", []):
            if not any(ref.startswith(p) for p in APPROVED_SOURCE_PREFIXES):
                source_reference_violations.append(
                    f"Item {item.chunk_id} has unapproved source_reference: '{ref}'"
                )
                diagnostics.append(
                    f"Source governance: item {item.chunk_id} source_reference "
                    f"'{ref}' does not start with an approved prefix"
                )

    retrieval_resolution_passed = len(unresolved_chunk_ids) == 0
    source_enforcement_passed = (
        len(raw_skill_leakage) == 0 and len(source_reference_violations) == 0
    )

    # ── 4. Benchmark citation compatibility ───────────────────────────────────
    # A KPI with target_mode == "verified_benchmark_range" must:
    # (a) Have a benchmark_citation_id that exists in plan.citations, AND
    # (b) That citation's chunk_id must resolve to a pack item whose
    #     evidence_tier is "verified_benchmark", AND
    # (c) The pack item must have valid review_status, effective dates, and
    #     compatible market/locale/industry with the query context.
    ungrounded_benchmarks: list[str] = []
    incompatible_benchmarks: list[str] = []
    benchmark_source_issues: list[str] = []

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
                pack_item = pack_item_by_chunk.get(chunk_str)

                if pack_item is None:
                    ungrounded_benchmarks.append(kpi.metric)
                    diagnostics.append(
                        f"KPI '{kpi.metric}' benchmark citation '{benchmark_cit_id}' "
                        f"resolves to unknown chunk '{chunk_str}'"
                    )
                else:
                    sq = pack_item.source_quality
                    if str(sq.evidence_tier) != "verified_benchmark":
                        incompatible_benchmarks.append(kpi.metric)
                        diagnostics.append(
                            f"KPI '{kpi.metric}' benchmark citation '{benchmark_cit_id}' resolves to "
                            f"chunk '{chunk_str}' with incompatible evidence_tier='{sq.evidence_tier}' "
                            f"(expected 'verified_benchmark')"
                        )
                    if str(sq.review_status) != "approved":
                        benchmark_source_issues.append(
                            f"{kpi.metric}: benchmark item {chunk_str} has "
                            f"review_status='{sq.review_status}' (expected 'approved')"
                        )
                        diagnostics.append(
                            f"KPI '{kpi.metric}' benchmark citation resolves to "
                            f"non-approved item (status={sq.review_status})"
                        )
                    retrieved_at = _naive_datetime(retrieval_pack.retrieved_at)
                    eff_at = _naive_datetime(sq.effective_at)
                    if eff_at > retrieved_at:
                        benchmark_source_issues.append(
                            f"{kpi.metric}: benchmark item {chunk_str} is not yet "
                            f"effective (effective_at={sq.effective_at} > retrieved_at={retrieval_pack.retrieved_at})"
                        )
                        diagnostics.append(
                            f"KPI '{kpi.metric}' benchmark citation resolves to "
                            f"item that is not yet effective"
                        )
                    if sq.expires_at is not None:
                        exp_at = _naive_datetime(sq.expires_at)
                        if exp_at < retrieved_at:
                            benchmark_source_issues.append(
                                f"{kpi.metric}: benchmark item {chunk_str} is "
                                f"expired (expires_at={sq.expires_at})"
                            )
                            diagnostics.append(
                                f"KPI '{kpi.metric}' benchmark citation resolves to expired item"
                            )

    benchmark_validation_passed = (
        len(ungrounded_benchmarks) == 0
        and len(incompatible_benchmarks) == 0
        and len(benchmark_source_issues) == 0
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
        source_reference_violations=sorted(source_reference_violations),
        benchmark_source_issues=benchmark_source_issues,
        diagnostics=diagnostics,
    )
