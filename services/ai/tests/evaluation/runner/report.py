import json
from datetime import datetime, timezone
from pathlib import Path

from pydantic import BaseModel, Field


class SubqueryEvalResult(BaseModel):
    subquery_category: str
    subquery_text: str
    returned_chunk_ids: list[str]
    expected_chunk_ids: list[str]
    matched_chunk_ids: list[str]
    passed: bool
    latency_ms: float = 0.0


class RetrievalEvalResult(BaseModel):
    case_id: str
    sector: str
    language: str
    description: str
    subquery_results: list[SubqueryEvalResult]
    retrieval_pass: bool
    top5_hit: bool
    forbidden_violation: bool
    forbidden_found: list[str] = []
    missed_chunk_ids: list[str] = Field(default_factory=list)
    detected_gap_categories: list[str]
    missing_gap_categories: list[str]
    total_latency_ms: float = 0.0
    top5_hit_rate: float = 0.0
    evaluated_for_top5: bool = False
    failure_category: str | None = None
    # Approval / revision signal: set by callers that track owner decisions.
    approval_signal: str | None = None  # "approved" | "revision_requested" | None
    # Embedding cost in USD for this case's retrieval subqueries (0 for fake provider).
    embedding_cost_usd: float = 0.0
    # Relevance-labelled metrics. None means the dataset did not provide
    # enough labels for that metric; it must not be interpreted as zero.
    ranked_chunk_ids: list[str] = Field(default_factory=list)
    precision_at_5: float | None = None
    recall_at_5: float | None = None
    mrr_at_5: float | None = None
    metric_unmeasured_reasons: dict[str, str] = Field(default_factory=dict)


class FilterEvalResult(BaseModel):
    case_id: str
    chunk_id: str
    filter_reason: str
    was_filtered: bool


class ComparisonMetric(BaseModel):
    case_id: str
    case_language: str
    case_sector: str
    rag_citations_count: int
    no_rag_citations_count: int
    rag_grounding_passed: bool
    no_rag_grounding_passed: bool
    rag_sourced_claims: int
    no_rag_sourced_claims: int
    grounding_improvement_score: float
    has_more_grounded_claims: bool
    summary: str
    rag_diagnostics: list[str] = Field(default_factory=list)
    no_rag_diagnostics: list[str] = Field(default_factory=list)


class GroundingSummary(BaseModel):
    citation_integrity_failures: int = 0
    retrieval_resolution_failures: int = 0
    benchmark_validation_failures: int = 0
    source_enforcement_failures: int = 0
    source_reference_violations: list[str] = Field(default_factory=list)
    ungrounded_kpis: list[str] = Field(default_factory=list)


class EvaluationReport(BaseModel):
    dataset_version: str = "eval-v1"
    run_at: str = ""
    embedding_provider: str = ""
    selection_mode: str = "semantic"
    top5_hit_rate: float = 0.0
    hard_filter_violations: int = 0
    cases_passed: int = 0
    cases_failed: int = 0
    empty_result_with_no_gap_count: int = 0
    avg_retrieval_latency_ms: float = 0.0
    approved_count: int = 0
    revision_requested_count: int = 0
    review_outcome_unavailable_count: int = 0
    total_embedding_cost_usd: float = 0.0
    per_case: list[dict] = Field(default_factory=list)
    failure_breakdown: dict[str, int] = Field(default_factory=dict)
    filter_results: list[FilterEvalResult] = Field(default_factory=list)
    privacy_issues: list[str] = Field(default_factory=list)
    retrieval_results: list[RetrievalEvalResult] = Field(default_factory=list)
    comparison_metrics: list[ComparisonMetric] = Field(default_factory=list)
    grounding_summary: GroundingSummary = Field(default_factory=GroundingSummary)
    localization_issues: list[str] = Field(default_factory=list)
    approval_signal_source: str = "reviewed_dataset"
    precision_at_5: float | None = None
    recall_at_5: float | None = None
    mrr_at_5: float | None = None
    precision_measured_case_count: int = 0
    recall_measured_case_count: int = 0
    mrr_measured_case_count: int = 0
    metrics_measured_case_count: int = 0
    metrics_unmeasured_case_count: int = 0
    metric_unmeasured_reasons: dict[str, int] = Field(default_factory=dict)


def build_report(
    retrieval_results: list[RetrievalEvalResult],
    dataset_version: str = "eval-v1",
    embedding_provider: str = "fake",
    filter_results: list[FilterEvalResult] | None = None,
    privacy_issues: list[str] | None = None,
    comparison_metrics: list[ComparisonMetric] | None = None,
    grounding_summary: GroundingSummary | None = None,
    localization_issues: list[str] | None = None,
    approval_signal_source: str = "reviewed_dataset",
    selection_mode: str = "semantic",
) -> EvaluationReport:
    total = len(retrieval_results)
    passed = sum(1 for r in retrieval_results if r.retrieval_pass)
    failed = total - passed
    avg_latency = (
        sum(r.total_latency_ms for r in retrieval_results) / total
        if total > 0
        else 0.0
    )
    evaluated = [r for r in retrieval_results if r.evaluated_for_top5]
    overall_top5 = (
        sum(1 for r in evaluated if r.top5_hit) / len(evaluated)
        if evaluated
        else 0.0
    )
    hard_filter_violations = sum(1 for r in retrieval_results if r.forbidden_violation)
    empty_no_gap = sum(
        1 for r in retrieval_results
        if r.top5_hit_rate == 0.0 and not r.detected_gap_categories
    )

    KNOWN_CATEGORIES = {"corpus", "retrieval", "hard_filter", "privacy", "contract", "rule", "prompt"}
    breakdown: dict[str, int] = {cat: 0 for cat in KNOWN_CATEGORIES}
    for r in retrieval_results:
        if not r.retrieval_pass:
            if r.failure_category and r.failure_category in KNOWN_CATEGORIES:
                # Caller has already classified the failure — trust it.
                breakdown[r.failure_category] += 1
            else:
                # Derive category from observed evidence.
                if r.forbidden_violation:
                    breakdown["hard_filter"] += 1
                elif r.missing_gap_categories:
                    breakdown["corpus"] += 1
                elif any(not sr.passed for sr in r.subquery_results):
                    breakdown["retrieval"] += 1
                else:
                    # Unknown; count as retrieval by default.
                    breakdown["retrieval"] += 1

    # Approval / revision signal aggregation
    approved_count = sum(1 for r in retrieval_results if r.approval_signal == "approved")
    revision_requested_count = sum(1 for r in retrieval_results if r.approval_signal == "revision_requested")
    unavailable_count = sum(1 for r in retrieval_results if r.approval_signal is None)
    total_embedding_cost = sum(r.embedding_cost_usd for r in retrieval_results)

    def _average_metric(name: str) -> float | None:
        values = [
            value
            for result in retrieval_results
            if (value := getattr(result, name)) is not None
        ]
        return round(sum(values) / len(values), 4) if values else None

    precision_at_5 = _average_metric("precision_at_5")
    recall_at_5 = _average_metric("recall_at_5")
    mrr_at_5 = _average_metric("mrr_at_5")
    precision_measured = sum(
        1 for result in retrieval_results if result.precision_at_5 is not None
    )
    recall_measured = sum(
        1 for result in retrieval_results if result.recall_at_5 is not None
    )
    mrr_measured = sum(
        1 for result in retrieval_results if result.mrr_at_5 is not None
    )
    metrics_measured = sum(
        1
        for result in retrieval_results
        if result.precision_at_5 is not None
        and result.recall_at_5 is not None
        and result.mrr_at_5 is not None
    )
    metric_reasons: dict[str, int] = {}
    for result in retrieval_results:
        for metric, reason in result.metric_unmeasured_reasons.items():
            key = f"{metric}:{reason}"
            metric_reasons[key] = metric_reasons.get(key, 0) + 1

    per_case = [
        {
            "id": r.case_id,
            "sector": r.sector,
            "language": r.language,
            "passed": r.retrieval_pass,
            "top5_hit": r.top5_hit,
            "forbidden_violation": r.forbidden_violation,
            "missed_chunk_ids": r.missed_chunk_ids,
            "latency_ms": r.total_latency_ms,
            "failure_category": r.failure_category,
            "approval_signal": r.approval_signal,
            "embedding_cost_usd": r.embedding_cost_usd,
            "ranked_chunk_ids": r.ranked_chunk_ids,
            "precision_at_5": r.precision_at_5,
            "recall_at_5": r.recall_at_5,
            "mrr_at_5": r.mrr_at_5,
            "metric_unmeasured_reasons": r.metric_unmeasured_reasons,
        }
        for r in retrieval_results
    ]

    return EvaluationReport(
        dataset_version=dataset_version,
        run_at=datetime.now(timezone.utc).isoformat(),
        embedding_provider=embedding_provider,
        selection_mode=selection_mode,
        top5_hit_rate=round(overall_top5, 4),
        hard_filter_violations=hard_filter_violations,
        cases_passed=passed,
        cases_failed=failed,
        empty_result_with_no_gap_count=empty_no_gap,
        avg_retrieval_latency_ms=round(avg_latency, 2),
        approved_count=approved_count,
        revision_requested_count=revision_requested_count,
        review_outcome_unavailable_count=unavailable_count,
        total_embedding_cost_usd=round(total_embedding_cost, 6),
        per_case=per_case,
        failure_breakdown=breakdown,
        filter_results=filter_results or [],
        privacy_issues=privacy_issues or [],
        retrieval_results=retrieval_results,
        comparison_metrics=comparison_metrics or [],
        grounding_summary=grounding_summary or GroundingSummary(),
        localization_issues=localization_issues or [],
        approval_signal_source=approval_signal_source,
        precision_at_5=precision_at_5,
        recall_at_5=recall_at_5,
        mrr_at_5=mrr_at_5,
        precision_measured_case_count=precision_measured,
        recall_measured_case_count=recall_measured,
        mrr_measured_case_count=mrr_measured,
        metrics_measured_case_count=metrics_measured,
        metrics_unmeasured_case_count=total - metrics_measured,
        metric_unmeasured_reasons=metric_reasons,
    )


def format_human_summary(report: EvaluationReport) -> str:
    lines = []
    pct = round(report.top5_hit_rate * 100, 1)
    target = 80.0
    hit_ok = "✅" if pct >= target else "❌"
    hf_ok = "✅" if report.hard_filter_violations == 0 else "❌"
    gap_ok = "✅" if report.empty_result_with_no_gap_count == 0 else "❌"

    lines.append(f"=== Retrieval Evaluation Report — {report.dataset_version} ===")
    lines.append(f"Cases: {report.cases_passed + report.cases_failed} | Passed: {report.cases_passed} | Failed: {report.cases_failed}")
    lines.append(f"Top-5 hit rate: {pct}% (target >= {target}%) {hit_ok}")
    lines.append(f"Hard-filter violations: {report.hard_filter_violations} {hf_ok}")
    lines.append(f"Empty-result with no gap: {report.empty_result_with_no_gap_count} {gap_ok}")
    lines.append(f"Avg retrieval latency: {report.avg_retrieval_latency_ms}ms")
    lines.append(f"Embedding provider: {report.embedding_provider}")
    lines.append(f"Selection mode: {report.selection_mode}")
    metric_values = (
        f"precision@5={report.precision_at_5} "
        f"recall@5={report.recall_at_5} mrr@5={report.mrr_at_5}"
    )
    lines.append(
        "Labeled ranking metrics: "
        f"{metric_values} "
        f"(measured cases: precision {report.precision_measured_case_count}, "
        f"recall {report.recall_measured_case_count}, "
        f"MRR {report.mrr_measured_case_count}; fully measured "
        f"{report.metrics_measured_case_count}/"
        f"{report.metrics_measured_case_count + report.metrics_unmeasured_case_count})"
    )
    if report.metric_unmeasured_reasons:
        lines.append(
            "Unmeasured metric reasons: "
            + ", ".join(
                f"{reason} ({count})"
                for reason, count in sorted(report.metric_unmeasured_reasons.items())
            )
        )
    lines.append("")

    if report.cases_failed > 0:
        lines.append("Failed cases:")
        for pc in report.per_case:
            if not pc["passed"]:
                cat = pc["failure_category"] or "unknown"
                lines.append(f"  ❌ {pc['id']} [{cat}]")
                r = next((x for x in report.retrieval_results if x.case_id == pc["id"]), None)
                if r:
                    if r.forbidden_violation:
                        lines.append(f"      forbidden violation — found chunks: {r.forbidden_found}")
                    if r.missing_gap_categories:
                        lines.append(f"      missing gaps: {r.missing_gap_categories}")
                    for sr in r.subquery_results:
                        if not sr.passed:
                            lines.append(f"      {sr.subquery_category}: expected {sr.expected_chunk_ids}, got {sr.returned_chunk_ids}")
        for f in report.filter_results:
            if not f.was_filtered:
                lines.append(f"  Filter fail: {f.case_id} chunk {f.chunk_id} reason={f.filter_reason}")

    if report.privacy_issues:
        lines.append("Privacy issues:")
        for issue in report.privacy_issues:
            lines.append(f"  - {issue}")

    bd = report.failure_breakdown
    if bd:
        parts = " ".join(f"{k}={v}" for k, v in sorted(bd.items()))
        lines.append("")
        lines.append(f"Failure breakdown: {parts}")

    gs = report.grounding_summary
    if gs and (gs.citation_integrity_failures > 0 or gs.retrieval_resolution_failures > 0 or gs.benchmark_validation_failures > 0 or gs.source_enforcement_failures > 0):
        lines.append("")
        lines.append("Grounding issues:")
        if gs.citation_integrity_failures > 0:
            lines.append(f"  citation integrity failures: {gs.citation_integrity_failures}")
        if gs.retrieval_resolution_failures > 0:
            lines.append(f"  retrieval resolution failures: {gs.retrieval_resolution_failures}")
        if gs.benchmark_validation_failures > 0:
            lines.append(f"  benchmark validation failures: {gs.benchmark_validation_failures}")
        if gs.source_enforcement_failures > 0:
            lines.append(f"  source enforcement failures: {gs.source_enforcement_failures}")
        if gs.source_reference_violations:
            lines.append(f"  source_reference violations: {gs.source_reference_violations}")
        if gs.ungrounded_kpis:
            lines.append(f"  ungrounded KPIs: {gs.ungrounded_kpis}")

    if report.comparison_metrics:
        lines.append("")
        lines.append(f"RAG vs No-RAG comparison ({len(report.comparison_metrics)} cases):")
        improved = sum(1 for m in report.comparison_metrics if m.has_more_grounded_claims)
        avg_improvement = (
            sum(m.grounding_improvement_score for m in report.comparison_metrics)
            / len(report.comparison_metrics)
        )
        lines.append(f"  RAG improved grounding: {improved}/{len(report.comparison_metrics)} cases")
        lines.append(f"  avg grounding improvement score: {round(avg_improvement, 2)}")

    return "\n".join(lines)


def format_json_report(report: EvaluationReport) -> dict:
    return report.model_dump(mode="json")


def write_report_file(report: EvaluationReport, path: str | Path = "evaluation_report.json") -> str:
    path = Path(path)
    data = format_json_report(report)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False))
    return str(path.resolve())
