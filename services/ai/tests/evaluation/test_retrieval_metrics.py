import pytest
from pydantic import ValidationError

from tests.evaluation.dataset.schema import ExpectedRetrieval
from tests.evaluation.runner.metrics import measure_labeled_metrics


def test_labeled_metrics_measure_all_three_values() -> None:
    result = measure_labeled_metrics(
        ["a", "b", "c", "d", "e"],
        {
            "a": "not_relevant",
            "b": "relevant",
            "c": "not_relevant",
            "d": "relevant",
            "e": "not_relevant",
        },
        ["b", "d"],
        relevance_labels_complete=True,
    )

    assert result.precision_at_5 == 0.4
    assert result.recall_at_5 == 1.0
    assert result.mrr_at_5 == 0.5
    assert result.unmeasured_reasons == {}


def test_labeled_metrics_report_missing_evidence_as_unmeasured() -> None:
    result = measure_labeled_metrics(
        ["a", "b", "c"],
        {"a": "relevant"},
        ["a"],
        relevance_labels_complete=False,
    )

    assert result.precision_at_5 is None
    assert result.mrr_at_5 is None
    assert result.recall_at_5 is None
    assert result.unmeasured_reasons == {
        "precision_at_5": "missing_candidate_labels",
        "mrr_at_5": "missing_candidate_labels",
        "recall_at_5": "complete_relevant_set_not_declared",
    }


def test_complete_relevance_labels_must_match_the_known_relevant_set() -> None:
    with pytest.raises(ValidationError, match="must exactly match"):
        ExpectedRetrieval(
            expected_chunk_ids=[],
            forbidden_chunk_ids=[],
            required_gap_categories=[],
            relevance_labels={"a": "relevant", "b": "relevant"},
            known_relevant_chunk_ids=["a"],
            relevance_labels_complete=True,
        )


def test_metrics_refuse_an_inconsistent_complete_relevant_set() -> None:
    result = measure_labeled_metrics(
        ["a"],
        {"a": "relevant", "b": "relevant"},
        ["a"],
        relevance_labels_complete=True,
    )

    assert result.precision_at_5 == 1.0
    assert result.mrr_at_5 == 1.0
    assert result.recall_at_5 is None
    assert result.unmeasured_reasons == {
        "recall_at_5": "complete_relevant_set_inconsistent"
    }


def test_report_averages_only_measured_metrics() -> None:
    from tests.evaluation.runner.report import RetrievalEvalResult, build_report

    measured = RetrievalEvalResult(
        case_id="measured",
        sector="retail",
        language="en",
        description="Measured",
        subquery_results=[],
        retrieval_pass=True,
        top5_hit=True,
        forbidden_violation=False,
        detected_gap_categories=[],
        missing_gap_categories=[],
        precision_at_5=0.5,
        recall_at_5=1.0,
        mrr_at_5=0.5,
    )
    unmeasured = RetrievalEvalResult(
        case_id="unmeasured",
        sector="retail",
        language="en",
        description="Unmeasured",
        subquery_results=[],
        retrieval_pass=True,
        top5_hit=True,
        forbidden_violation=False,
        detected_gap_categories=[],
        missing_gap_categories=[],
        metric_unmeasured_reasons={"recall_at_5": "complete_relevant_set_missing"},
    )

    report = build_report([measured, unmeasured])

    assert report.precision_at_5 == 0.5
    assert report.recall_at_5 == 1.0
    assert report.mrr_at_5 == 0.5
    assert report.precision_measured_case_count == 1
    assert report.recall_measured_case_count == 1
    assert report.mrr_measured_case_count == 1
    assert report.metrics_measured_case_count == 1
    assert report.metrics_unmeasured_case_count == 1
    assert report.metric_unmeasured_reasons == {
        "recall_at_5:complete_relevant_set_missing": 1
    }
