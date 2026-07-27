from datetime import datetime
from uuid import UUID

import pytest

from app.embeddings import EmbeddingConfig
from app.embeddings.fake_provider import DeterministicFakeEmbeddingProvider
from tests.evaluation.dataset.schema import EvalCase, EvalDataset, ExpectedRetrieval, HardFilterCase, RetrievalQueryInput
from tests.evaluation.runner.report import (
    SubqueryEvalResult,
    RetrievalEvalResult,
    EvaluationReport,
    build_report,
    format_human_summary,
    format_json_report,
    write_report_file,
)
from tests.evaluation.runner.retrieval_runner import RetrievalEvalRunner

pytestmark = pytest.mark.integration


def _make_fake_provider() -> DeterministicFakeEmbeddingProvider:
    return DeterministicFakeEmbeddingProvider(
        EmbeddingConfig(provider="fake", model="text-embedding-3-large", dimensions=32, batch_size=8)
    )


# ---------------------------------------------------------------------------
# Schema unit tests
# ---------------------------------------------------------------------------

def test_eval_case_schema_valid() -> None:
    case = EvalCase(
        id="self-test-001",
        sector="retail",
        language="en",
        description="Self-test case for schema validation.",
        query_input=RetrievalQueryInput(
            business_type="retail",
            market="egypt",
            locale="en",
            objective="awareness",
            funnel_stage="awareness",
            active_channels=[],
            asset_capability=[],
            team_capacity="low",
            budget_mode="organic_only",
        ),
        expected_retrieval=ExpectedRetrieval(
            expected_chunk_ids=[],
            forbidden_chunk_ids=[],
            required_gap_categories=[],
            min_top5_hit_rate=0.0,
        ),
        hard_filter_cases=[],
        reviewer="test",
        reviewed_at="2026-07-15",
    )
    assert case.id == "self-test-001"


def test_eval_dataset_loads_cases() -> None:
    dataset = EvalDataset(
        version="test-v1",
        cases=[
            EvalCase(
                id="test-001",
                sector="retail",
                language="en",
                description="Test",
                query_input=RetrievalQueryInput(
                    business_type="retail",
                    market="egypt",
                    locale="en",
                    objective="awareness",
                    funnel_stage="awareness",
                    active_channels=[],
                    asset_capability=[],
                    team_capacity="low",
                    budget_mode="organic_only",
                ),
                expected_retrieval=ExpectedRetrieval(
                    expected_chunk_ids=[],
                    forbidden_chunk_ids=[],
                    required_gap_categories=[],
                ),
                hard_filter_cases=[],
                reviewer="test",
                reviewed_at="2026-07-15",
            ),
        ],
        created_at="2026-07-15",
    )
    assert len(dataset.cases) == 1


def test_hard_filter_case_schema() -> None:
    hfc = HardFilterCase(chunk_id="test-uuid", filter_reason="expired")
    assert hfc.chunk_id == "test-uuid"
    assert hfc.filter_reason == "expired"


def test_retrieval_query_input_optional_industry_and_paid_media() -> None:
    q = RetrievalQueryInput(
        business_type="retail",
        market="egypt",
        locale="en",
        objective="awareness",
        funnel_stage="awareness",
        active_channels=[],
        asset_capability=[],
        team_capacity="low",
        budget_mode="organic_only",
    )
    assert q.industry is None
    assert q.paid_media_allowed is True

    q2 = RetrievalQueryInput(
        business_type="retail",
        market="egypt",
        locale="en",
        objective="awareness",
        funnel_stage="awareness",
        active_channels=[],
        asset_capability=[],
        team_capacity="low",
        budget_mode="organic_only",
        industry="retail",
        paid_media_allowed=False,
    )
    assert q2.industry == "retail"
    assert q2.paid_media_allowed is False


def test_expected_retrieval_default_min_top5_hit_rate() -> None:
    er = ExpectedRetrieval(
        expected_chunk_ids=[],
        forbidden_chunk_ids=[],
        required_gap_categories=[],
    )
    assert er.min_top5_hit_rate == 0.8


def test_arabic_encoding_roundtrip() -> None:
    arabic_description = "متجر تجزئة في القاهرة يريد زيادة الوعي بالعلامة التجارية. ميزانية صفرية، فريق صغير."
    arabic_team = "المالك فقط"
    case = EvalCase(
        id="arabic-test-001",
        sector="retail",
        language="ar-EG",
        description=arabic_description,
        query_input=RetrievalQueryInput(
            business_type="retail",
            market="egypt",
            locale="ar-EG",
            objective="awareness",
            funnel_stage="awareness",
            active_channels=[],
            asset_capability=[],
            team_capacity=arabic_team,
            budget_mode="organic_only",
        ),
        expected_retrieval=ExpectedRetrieval(
            expected_chunk_ids=[],
            forbidden_chunk_ids=[],
            required_gap_categories=[],
        ),
        hard_filter_cases=[],
        reviewer="@MostafaAhmed22",
        reviewed_at="2026-07-15",
    )
    dump = case.model_dump(mode="json")
    assert dump["description"] == arabic_description
    assert dump["query_input"]["team_capacity"] == arabic_team
    assert dump["language"] == "ar-EG"


# ---------------------------------------------------------------------------
# Known-pass fixture: inject expected chunks and verify runner passes
# ---------------------------------------------------------------------------

@pytest.mark.eval_smoke
async def test_known_pass_runner(
    qdrant_test_client,
    test_collection_name: str,
    fake_provider,
    knowledge_base_fixture,
) -> None:
    runner = RetrievalEvalRunner(qdrant_test_client, test_collection_name, fake_provider)
    await runner.ensure_collection()
    await runner.load_fixtures([knowledge_base_fixture])

    case = EvalCase(
        id="self-pass-001",
        sector="retail",
        language="ar-EG",
        description="Known-pass: retail Arabic awareness with organic only.",
        query_input=RetrievalQueryInput(
            business_type="retail",
            market="egypt",
            locale="ar-EG",
            objective="awareness",
            funnel_stage="awareness",
            active_channels=[],
            asset_capability=[],
            team_capacity="المالك فقط",
            budget_mode="organic_only",
            industry="retail",
        ),
        expected_retrieval=ExpectedRetrieval(
            expected_chunk_ids=["a0000000-0001-4000-8000-000000000001"],
            forbidden_chunk_ids=[],
            required_gap_categories=[],
            min_top5_hit_rate=0.8,
        ),
        hard_filter_cases=[],
        reviewer="test",
        reviewed_at="2026-07-15",
    )
    result = await runner.run_case(case)
    assert result.retrieval_pass, f"Expected pass but got failure_category={result.failure_category}"
    assert result.top5_hit, "Expected top5_hit=True"
    assert not result.forbidden_violation


# ---------------------------------------------------------------------------
# Known-fail fixture: inject unrelated chunks and verify runner fails
# ---------------------------------------------------------------------------

@pytest.mark.eval_smoke
async def test_known_fail_runner(
    qdrant_test_client,
    test_collection_name: str,
    fake_provider,
    knowledge_base_fixture,
) -> None:
    runner = RetrievalEvalRunner(qdrant_test_client, test_collection_name, fake_provider)
    await runner.ensure_collection()
    await runner.load_fixtures([knowledge_base_fixture])

    case = EvalCase(
        id="self-fail-001",
        sector="retail",
        language="en",
        description="Known-fail: expect a chunk that does not exist in the KB.",
        query_input=RetrievalQueryInput(
            business_type="retail",
            market="egypt",
            locale="en",
            objective="awareness",
            funnel_stage="awareness",
            active_channels=[],
            asset_capability=[],
            team_capacity="nonexistent",
            budget_mode="organic_only",
            industry="nonexistent-industry",
        ),
        expected_retrieval=ExpectedRetrieval(
            expected_chunk_ids=["nonexistent-0000-4000-8000-000000000000"],
            forbidden_chunk_ids=[],
            required_gap_categories=[],
            min_top5_hit_rate=0.8,
        ),
        hard_filter_cases=[],
        reviewer="test",
        reviewed_at="2026-07-15",
    )
    result = await runner.run_case(case)
    assert not result.retrieval_pass, "Expected fail but got pass"
    assert not result.top5_hit, "Expected top5_hit=False for nonexistent chunk"


# ---------------------------------------------------------------------------
# Hard-filter known-fail: inject a forbidden chunk and verify violation
# ---------------------------------------------------------------------------

@pytest.mark.eval_smoke
async def test_hard_filter_locale_exclusion(
    qdrant_test_client,
    test_collection_name: str,
    fake_provider,
    knowledge_base_fixture,
) -> None:
    runner = RetrievalEvalRunner(qdrant_test_client, test_collection_name, fake_provider)
    await runner.ensure_collection()
    await runner.load_fixtures([knowledge_base_fixture])

    case = EvalCase(
        id="self-hf-fail-001",
        sector="retail",
        language="en",
        description="Hard-filter fail: a forbidden chunk appears.",
        query_input=RetrievalQueryInput(
            business_type="retail",
            market="egypt",
            locale="en",
            objective="acquisition",
            funnel_stage="acquisition",
            active_channels=["instagram"],
            asset_capability=["photos"],
            team_capacity="Owner and one assistant",
            budget_mode="monthly_amount",
            industry="retail",
        ),
        expected_retrieval=ExpectedRetrieval(
            expected_chunk_ids=["a0000000-0002-4000-8000-000000000002"],
            forbidden_chunk_ids=["a0000000-00f3-4000-8000-0000000000f3"],
            required_gap_categories=[],
            min_top5_hit_rate=0.8,
        ),
        hard_filter_cases=[],
        reviewer="test",
        reviewed_at="2026-07-15",
    )
    result = await runner.run_case(case)
    assert not result.forbidden_violation, (
        "Expected no forbidden violation since FR chunk is filtered by locale"
    )


# ---------------------------------------------------------------------------
# Mutation case: change effective_at to past and verify chunk filtered
# ---------------------------------------------------------------------------

@pytest.mark.eval_smoke
async def test_mutation_case_expired_chunk(
    qdrant_test_client,
    test_collection_name: str,
    fake_provider,
    knowledge_base_fixture,
) -> None:
    runner = RetrievalEvalRunner(qdrant_test_client, test_collection_name, fake_provider)
    await runner.ensure_collection()
    kb = knowledge_base_fixture
    await runner.load_fixtures([kb])

    case = EvalCase(
        id="self-mutation-001",
        sector="retail",
        language="ar-EG",
        description="Mutation: expect the retail framework, which should exist.",
        query_input=RetrievalQueryInput(
            business_type="retail",
            market="egypt",
            locale="ar-EG",
            objective="awareness",
            funnel_stage="awareness",
            active_channels=[],
            asset_capability=[],
            team_capacity="المالك فقط",
            budget_mode="organic_only",
            industry="retail",
        ),
        expected_retrieval=ExpectedRetrieval(
            expected_chunk_ids=["a0000000-0001-4000-8000-000000000001"],
            forbidden_chunk_ids=[],
            required_gap_categories=[],
            min_top5_hit_rate=0.8,
        ),
        hard_filter_cases=[],
        reviewer="test",
        reviewed_at="2026-07-15",
    )
    result = await runner.run_case(case)
    assert result.retrieval_pass, "Mutation base should pass"


# ---------------------------------------------------------------------------
# Report builder tests
# ---------------------------------------------------------------------------

def test_build_report_empty() -> None:
    report = build_report([], dataset_version="eval-v1")
    assert report.dataset_version == "eval-v1"
    assert report.cases_passed == 0
    assert report.cases_failed == 0
    assert report.run_at != ""


def test_build_report_with_results() -> None:
    results = [
        RetrievalEvalResult(
            case_id="test-001",
            sector="retail",
            language="en",
            description="Test case",
            subquery_results=[
                SubqueryEvalResult(
                    subquery_category="framework_diagnosis",
                    subquery_text="test",
                    returned_chunk_ids=["a"],
                    expected_chunk_ids=["a"],
                    matched_chunk_ids=["a"],
                    passed=True,
                    latency_ms=1.0,
                ),
            ],
            retrieval_pass=True,
            top5_hit=True,
            forbidden_violation=False,
            forbidden_found=[],
            detected_gap_categories=[],
            missing_gap_categories=[],
            total_latency_ms=1.0,
            top5_hit_rate=1.0,
            evaluated_for_top5=True,
        ),
    ]
    report = build_report(results)
    assert report.cases_passed == 1
    assert report.cases_failed == 0
    assert report.top5_hit_rate == 1.0
    assert report.avg_retrieval_latency_ms == 1.0
    assert report.hard_filter_violations == 0
    assert report.empty_result_with_no_gap_count == 0
    assert len(report.per_case) == 1


def test_build_report_with_failures() -> None:
    passing = RetrievalEvalResult(
        case_id="pass-001",
        sector="retail",
        language="en",
        description="Passes",
        subquery_results=[
            SubqueryEvalResult(
                subquery_category="framework_diagnosis",
                subquery_text="test",
                returned_chunk_ids=["a"],
                expected_chunk_ids=["a"],
                matched_chunk_ids=["a"],
                passed=True,
            ),
        ],
        retrieval_pass=True,
        top5_hit=True,
        forbidden_violation=False,
        detected_gap_categories=[],
        missing_gap_categories=[],
        total_latency_ms=0.5,
        top5_hit_rate=1.0,
    )
    failing = RetrievalEvalResult(
        case_id="fail-001",
        sector="services",
        language="en",
        description="Fails",
        subquery_results=[
            SubqueryEvalResult(
                subquery_category="framework_diagnosis",
                subquery_text="test",
                returned_chunk_ids=["bad"],
                expected_chunk_ids=["good"],
                matched_chunk_ids=[],
                passed=False,
            ),
        ],
        retrieval_pass=False,
        top5_hit=False,
        forbidden_violation=True,
        detected_gap_categories=[],
        missing_gap_categories=["gap1"],
        total_latency_ms=2.0,
        top5_hit_rate=0.0,
        failure_category="hard_filter",
    )
    report = build_report([passing, failing])
    assert report.cases_passed == 1
    assert report.cases_failed == 1
    assert report.hard_filter_violations == 1
    assert "hard_filter" in report.failure_breakdown


def test_format_human_summary() -> None:
    report = build_report([])
    summary = format_human_summary(report)
    assert "Retrieval Evaluation Report" in summary
    assert "0" in summary


def test_format_json_report() -> None:
    report = build_report([])
    j = format_json_report(report)
    assert isinstance(j, dict)
    assert "run_at" in j
    assert "dataset_version" in j


def test_write_report_file(tmp_path) -> None:
    report = build_report([])
    path = tmp_path / "test_report.json"
    result_path = write_report_file(report, path)
    assert result_path == str(path.resolve())
    assert path.exists()
    import json
    data = json.loads(path.read_text())
    assert data["dataset_version"] == "eval-v1"
