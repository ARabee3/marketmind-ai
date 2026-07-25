from uuid import uuid4

from app.rag.schemas import RetrievalCandidate
from app.rag.regional import apply_regional_preference


def _make_cand(tier: str, score: float = 0.9) -> RetrievalCandidate:
    return RetrievalCandidate(
        chunk_id=uuid4(),
        entry_id=uuid4(),
        entry_version=1,
        score=score,
        payload={"market_tier": tier},
        subquery_category="test",
    )


def test_egypt_preference():
    candidates = [
        _make_cand("global", 0.95),
        _make_cand("mena", 0.92),
        _make_cand("egypt", 0.90),
    ]
    
    sorted_cands = apply_regional_preference(candidates, "egypt")
    
    assert len(sorted_cands) == 3
    
    # Egypt should be first despite lower score
    assert sorted_cands[0].market_tier == "egypt"
    assert not sorted_cands[0].is_fallback
    assert sorted_cands[0].fallback_label is None
    
    # MENA should be second
    assert sorted_cands[1].market_tier == "mena"
    assert sorted_cands[1].is_fallback
    assert "Fallback to MENA" in sorted_cands[1].fallback_label
    
    # Global should be last
    assert sorted_cands[2].market_tier == "global"
    assert sorted_cands[2].is_fallback
    assert "Fallback to GLOBAL" in sorted_cands[2].fallback_label


def test_mena_preference():
    candidates = [
        _make_cand("global", 0.95),
        _make_cand("mena", 0.90),
    ]
    
    sorted_cands = apply_regional_preference(candidates, "mena")
    
    # MENA first
    assert sorted_cands[0].market_tier == "mena"
    assert not sorted_cands[0].is_fallback
    
    # Global second
    assert sorted_cands[1].market_tier == "global"
    assert sorted_cands[1].is_fallback
    assert "Fallback to GLOBAL" in sorted_cands[1].fallback_label


def test_score_tiebreaker():
    candidates = [
        _make_cand("egypt", 0.90),
        _make_cand("egypt", 0.95),
    ]
    
    sorted_cands = apply_regional_preference(candidates, "egypt")
    
    # 0.95 should be first
    assert sorted_cands[0].candidate.score == 0.95
    assert sorted_cands[1].candidate.score == 0.90
