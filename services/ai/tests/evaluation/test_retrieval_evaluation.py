import pytest

from tests.evaluation.conftest import (
    all_fixture_data,
    eval_dataset,
)
from tests.evaluation.dataset.schema import EvalCase, EvalDataset
from tests.evaluation.runner.report import EvaluationReport, format_human_summary, format_json_report
from tests.evaluation.runner.retrieval_runner import RetrievalEvalRunner

pytestmark = pytest.mark.integration

FRAMEWORK_DIAGNOSIS_CHUNK_ID = "a0000000-0050-4000-8000-000000000050"
SERVICES_FRAMEWORK_CHUNK_ID = "a0000000-0020-4000-8000-000000000020"


def _smoke_cases(dataset: EvalDataset) -> list[EvalCase]:
    seen_sectors: set[str] = set()
    selected: list[EvalCase] = []
    for c in dataset.cases:
        if c.sector not in seen_sectors:
            selected.append(c)
            seen_sectors.add(c.sector)
    return selected


@pytest.mark.eval_smoke
async def test_retrieval_evaluation_smoke(
    qdrant_test_client,
    test_collection_name: str,
    fake_provider,
    eval_dataset: EvalDataset,
    all_fixture_data: list[list[dict]],
) -> None:
    runner = RetrievalEvalRunner(qdrant_test_client, test_collection_name, fake_provider)
    await runner.ensure_collection()
    await runner.load_fixtures(all_fixture_data)

    cases = _smoke_cases(eval_dataset)
    report = await runner.run_dataset(cases)
    assert report.cases_passed + report.cases_failed == 5
    # The 80 % top-5 threshold is enforced unconditionally — fake provider is
    # deterministic and must meet the same bar as a real embedding provider.
    _assert_no_failures(report)

    assert report.embedding_provider == "fake"
    assert report.run_at != ""
    assert report.avg_retrieval_latency_ms >= 0

    # Approval / revision signal and embedding-cost fields must be present
    # (values are 0 for fake provider; the schema and aggregation are validated).
    assert isinstance(report.approved_count, int)
    assert isinstance(report.revision_requested_count, int)
    assert isinstance(report.total_embedding_cost_usd, float)
    assert report.total_embedding_cost_usd == 0.0  # fake provider costs nothing
    for pc in report.per_case:
        assert "approval_signal" in pc
        assert "embedding_cost_usd" in pc
        assert pc["embedding_cost_usd"] == 0.0

    _ = format_human_summary(report)
    _ = format_json_report(report)


@pytest.mark.eval_smoke
async def test_general_framework_diagnosis_is_retrieved_for_arabic_and_english(
    qdrant_test_client,
    test_collection_name: str,
    fake_provider,
    eval_dataset: EvalDataset,
    all_fixture_data: list[list[dict]],
) -> None:
    runner = RetrievalEvalRunner(
        qdrant_test_client,
        test_collection_name,
        fake_provider,
    )
    await runner.ensure_collection()
    await runner.load_fixtures(all_fixture_data)

    cases = {
        case.id: case
        for case in eval_dataset.cases
        if case.id in {"retail-ar-awareness-001", "retail-en-acquisition-002"}
    }
    assert set(cases) == {
        "retail-ar-awareness-001",
        "retail-en-acquisition-002",
    }

    for case in cases.values():
        result = await runner.run_case(case)
        framework_result = next(
            subquery
            for subquery in result.subquery_results
            if subquery.subquery_category == "framework_diagnosis"
        )
        assert FRAMEWORK_DIAGNOSIS_CHUNK_ID in framework_result.returned_chunk_ids
        assert SERVICES_FRAMEWORK_CHUNK_ID not in framework_result.returned_chunk_ids


@pytest.mark.eval_full
async def test_retrieval_evaluation_full(
    qdrant_test_client,
    test_collection_name: str,
    fake_provider,
    eval_dataset: EvalDataset,
    all_fixture_data: list[list[dict]],
) -> None:
    runner = RetrievalEvalRunner(qdrant_test_client, test_collection_name, fake_provider)
    await runner.ensure_collection()
    await runner.load_fixtures(all_fixture_data)

    report = await runner.run_dataset(eval_dataset.cases)
    assert report.cases_passed + report.cases_failed == 25
    # Enforce 80 % unconditionally — fake provider is deterministic and CI
    # must meet the same acceptance threshold as stated in Issue 75.
    _assert_no_failures(report)

    assert report.embedding_provider == "fake"
    assert report.avg_retrieval_latency_ms >= 0
    assert isinstance(report.failure_breakdown, dict)
    KNOWN_CATEGORIES = {"corpus", "retrieval", "hard_filter", "privacy", "contract", "rule", "prompt"}
    assert set(report.failure_breakdown.keys()) == KNOWN_CATEGORIES

    assert isinstance(report.per_case, list)
    assert len(report.per_case) == 25

    # Approval / revision signal and embedding-cost aggregation (Issue 75)
    assert isinstance(report.approved_count, int)
    assert isinstance(report.revision_requested_count, int)
    assert report.approved_count + report.revision_requested_count <= 25
    assert isinstance(report.total_embedding_cost_usd, float)
    assert report.total_embedding_cost_usd == 0.0  # fake provider costs nothing
    for pc in report.per_case:
        assert "approval_signal" in pc
        assert "embedding_cost_usd" in pc
        assert pc["embedding_cost_usd"] >= 0.0

    _ = format_human_summary(report)
    _ = format_json_report(report)


def _assert_no_failures(report: EvaluationReport) -> None:
    """Assert CI acceptance thresholds — enforced unconditionally for all providers.

    The 80 % top-5 hit rate is stated in Issue 75 as the acceptance target and
    must hold in the deterministic CI path using the fake embedding provider.
    Lowering the threshold for fake provider runs is explicitly disallowed.
    """
    assert report.hard_filter_violations == 0, f"Hard filter violations found: {report.hard_filter_violations}"
    assert report.top5_hit_rate >= 0.8, (
        f"Top-5 hit rate {report.top5_hit_rate:.1%} is below the required 80 % target. "
        "This threshold is non-negotiable for CI — do not lower it for fake/mock providers."
    )
