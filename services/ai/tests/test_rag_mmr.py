from uuid import uuid4

import pytest

from app.rag.dedup import deduplicate_and_cap
from app.rag.mmr import MMRSelectionError, reorder_regional_candidates_with_mmr, select_mmr
from app.rag.regional import apply_regional_preference
from app.rag.schemas import RegionalCandidate, RetrievalCandidate
from app.rag.selection import select_retrieval_candidates


def _candidate(
    *,
    category: str,
    vector: list[float] | None,
    score: float = 0.9,
) -> RetrievalCandidate:
    return RetrievalCandidate(
        chunk_id=uuid4(),
        entry_id=uuid4(),
        entry_version=1,
        score=score,
        payload={"markets": ["egypt"]},
        subquery_category=category,
        vector=vector,
    )


def _regional(candidate: RetrievalCandidate) -> RegionalCandidate:
    return RegionalCandidate(
        candidate=candidate,
        market_tier="egypt",
        is_fallback=False,
        fallback_label=None,
    )


def test_select_mmr_keeps_semantic_winner_and_diversifies_near_duplicates() -> None:
    query = [1.0, 0.0, 0.0]
    semantic_winner = _candidate(category="framework_diagnosis", vector=[0.95, 0.31, 0.0])
    near_duplicate = _candidate(category="framework_diagnosis", vector=[0.94, 0.34, 0.0])
    diverse_candidate = _candidate(category="framework_diagnosis", vector=[0.8, 0.0, 0.6])

    selected = select_mmr(
        [semantic_winner, near_duplicate, diverse_candidate],
        query,
        lambda_mult=0.5,
    )

    assert selected[0].chunk_id == semantic_winner.chunk_id
    assert selected[1].chunk_id == diverse_candidate.chunk_id
    assert selected[2].chunk_id == near_duplicate.chunk_id
    assert [item.chunk_id for item in select_mmr(
        [semantic_winner, near_duplicate, diverse_candidate],
        query,
        lambda_mult=0.5,
    )] == [item.chunk_id for item in selected]


def test_mmr_preserves_category_coverage_before_the_existing_cap() -> None:
    candidates = [
        _regional(
            _candidate(category="framework_diagnosis", vector=[1.0, 0.0, 0.0])
        ),
        _regional(
            _candidate(category="framework_diagnosis", vector=[0.99, 0.1, 0.0])
        ),
        _regional(
            _candidate(category="objective_funnel", vector=[0.0, 1.0, 0.0])
        ),
        _regional(
            _candidate(category="measurement_kpi", vector=[0.0, 0.0, 1.0])
        ),
    ]
    query_vectors = {
        "framework_diagnosis": [1.0, 0.0, 0.0],
        "objective_funnel": [0.0, 1.0, 0.0],
        "measurement_kpi": [0.0, 0.0, 1.0],
    }

    semantic_selected = deduplicate_and_cap(candidates, max_total=3)
    mmr_ordered = reorder_regional_candidates_with_mmr(
        candidates,
        query_vectors,
        requested_market="egypt",
        lambda_mult=0.5,
    )
    mmr_selected = deduplicate_and_cap(mmr_ordered, max_total=3)

    assert {
        item.candidate.subquery_category for item in mmr_selected
    } == {
        item.candidate.subquery_category for item in semantic_selected
    }


def test_mmr_fails_explicitly_when_a_candidate_vector_is_missing() -> None:
    first = _candidate(category="framework_diagnosis", vector=[1.0, 0.0])
    missing = _candidate(category="framework_diagnosis", vector=None)

    with pytest.raises(MMRSelectionError, match="missing its vector"):
        select_mmr([first, missing], [1.0, 0.0], lambda_mult=0.5)


def test_shared_semantic_selection_preserves_the_existing_pipeline() -> None:
    candidates = [
        _candidate(category="framework_diagnosis", vector=None, score=0.9),
        _candidate(category="objective_funnel", vector=None, score=0.8),
        _candidate(category="measurement_kpi", vector=None, score=0.7),
    ]

    expected = deduplicate_and_cap(apply_regional_preference(candidates, "egypt"))
    selected = select_retrieval_candidates(
        candidates,
        requested_market="egypt",
        selection_mode="semantic",
    )

    assert selected == expected
