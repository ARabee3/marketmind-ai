from uuid import UUID, uuid4

from app.rag.schemas import RetrievalCandidate, RegionalCandidate
from app.rag.dedup import deduplicate_and_cap


def _make_rc(
    entry_id: UUID,
    chunk_id: UUID | None = None,
    category: str = "test",
) -> RegionalCandidate:
    cid = uuid4() if not chunk_id else chunk_id
    cand = RetrievalCandidate(
        chunk_id=cid,
        entry_id=entry_id,
        entry_version=1,
        score=0.9,
        payload={},
        subquery_category=category,
    )
    return RegionalCandidate(
        candidate=cand,
        market_tier="egypt",
        is_fallback=False,
        fallback_label=None,
    )


def test_dedup_max_per_entry():
    entry_1 = uuid4()
    entry_2 = uuid4()
    
    candidates = [
        _make_rc(entry_1),
        _make_rc(entry_1),
        _make_rc(entry_1),  # Should be dropped
        _make_rc(entry_2),
    ]
    
    selected = deduplicate_and_cap(candidates, max_per_entry=2, max_total=8)
    
    assert len(selected) == 3
    entry_1_count = sum(1 for c in selected if c.candidate.entry_id == entry_1)
    assert entry_1_count == 2
    assert selected[-1].candidate.entry_id == entry_2


def test_dedup_exact_chunk():
    entry_1 = uuid4()
    chunk_1 = uuid4()
    
    candidates = [
        _make_rc(entry_1, chunk_1),
        _make_rc(entry_1, chunk_1),  # Exact duplicate
        _make_rc(entry_1),
    ]
    
    selected = deduplicate_and_cap(candidates, max_per_entry=2, max_total=8)
    
    # Should only keep 2 total, dropping the exact duplicate chunk
    assert len(selected) == 2


def test_dedup_max_total():
    # Make 10 unique chunks from 10 different entries
    candidates = [_make_rc(uuid4()) for _ in range(10)]
    
    selected = deduplicate_and_cap(candidates, max_per_entry=2, max_total=8)
    
    assert len(selected) == 8


def test_dedup_preserves_category_coverage_before_filling_total_cap():
    candidates = [
        *[_make_rc(uuid4(), category="local_channel") for _ in range(8)],
        _make_rc(uuid4(), category="framework_diagnosis"),
    ]

    selected = deduplicate_and_cap(candidates, max_per_entry=2, max_total=8)

    assert {item.candidate.subquery_category for item in selected} == {
        "local_channel",
        "framework_diagnosis",
    }
