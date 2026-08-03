from datetime import datetime, timezone, timedelta
from uuid import uuid4

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import (
    MarketingKnowledgeEntry,
    MarketingKnowledgeEntryVersion,
    MarketingKnowledgeChunk,
    MarketingKnowledgeSourceRef,
)
from app.rag.schemas import RetrievalCandidate, RegionalCandidate, RetrievalSubquery
from app.rag.hydrator import hydrate_candidates


pytestmark = pytest.mark.integration


@pytest.mark.asyncio
async def test_hydrate_candidates_and_gaps(db_session: AsyncSession):
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    past = now - timedelta(days=1)
    future = now + timedelta(days=1)

    # 1. Setup DB Data
    entry = MarketingKnowledgeEntry(slug="test-playbook", latest_version=1)
    db_session.add(entry)
    await db_session.flush()

    # Valid Version
    valid_version = MarketingKnowledgeEntryVersion(
        entry_id=entry.id,
        version=1,
        kind="framework",
        title="Valid Framework",
        summary="A summary",
        body="Body text",
        locale="en",
        evidence_tier="reviewed_guidance",
        review_status="approved",
        effective_at=past,
        expires_at=None,
        author="System",
        reviewer="System Reviewer",
        reviewed_at=past,
        checksum="hash1",
        markets=["egypt"],
    )
    db_session.add(valid_version)
    await db_session.flush()

    db_session.add(
        MarketingKnowledgeSourceRef(
            entry_version_id=valid_version.id, reference="Internal Test", note="Test Note"
        )
    )

    valid_chunk = MarketingKnowledgeChunk(
        chunk_id=uuid4(),
        entry_version_id=valid_version.id,
        chunk_order=1,
        text="This is valid.",
        token_count=10,
        checksum="hash2",
        embedding_provider="test",
        embedding_model="test",
        embedding_dimensions=1536,
        embedding_version="1",
    )
    db_session.add(valid_chunk)

    # Expired Version
    expired_version = MarketingKnowledgeEntryVersion(
        entry_id=entry.id,
        version=2,
        kind="objective_playbook",
        title="Expired Framework",
        summary="A summary",
        body="Body text",
        locale="en",
        evidence_tier="reviewed_guidance",
        review_status="approved",
        effective_at=past - timedelta(days=1),
        expires_at=past,  # Expired!
        author="System",
        reviewer="System Reviewer",
        reviewed_at=past,
        checksum="hash3",
    )
    db_session.add(expired_version)
    await db_session.flush()

    expired_chunk = MarketingKnowledgeChunk(
        chunk_id=uuid4(),
        entry_version_id=expired_version.id,
        chunk_order=1,
        text="This is expired.",
        token_count=10,
        checksum="hash4",
        embedding_provider="test",
        embedding_model="test",
        embedding_dimensions=1536,
        embedding_version="1",
    )
    db_session.add(expired_chunk)

    await db_session.commit()

    # 2. Setup Qdrant Candidates
    candidates = [
        RegionalCandidate(
            candidate=RetrievalCandidate(
                chunk_id=valid_chunk.chunk_id,
                entry_id=entry.id,
                entry_version=1,
                score=0.9,
                payload={},
                subquery_category="framework_diagnosis",
            ),
            market_tier="egypt",
            is_fallback=False,
            fallback_label=None,
        ),
        RegionalCandidate(
            candidate=RetrievalCandidate(
                chunk_id=expired_chunk.chunk_id,
                entry_id=entry.id,
                entry_version=2,
                score=0.8,
                payload={},
                subquery_category="objective_funnel",
            ),
            market_tier="egypt",
            is_fallback=False,
            fallback_label=None,
        )
    ]

    # 3. Subqueries
    subqueries = [
        RetrievalSubquery(category="framework_diagnosis", text="test", kind_filter="framework"),
        RetrievalSubquery(category="objective_funnel", text="test", kind_filter="objective"),
        RetrievalSubquery(category="measurement_kpi", text="test", kind_filter="measurement"),
    ]

    # 4. Hydrate
    items, gaps = await hydrate_candidates(db_session, candidates, subqueries, now)

    # 5. Assertions
    # Only 1 item should survive (the valid one)
    assert len(items) == 1
    assert items[0].chunk_id == valid_chunk.chunk_id
    assert items[0].title == "Valid Framework"
    assert items[0].source_references == ["Internal Test (Test Note)"]
    assert items[0].tags["markets"] == ["egypt"]
    assert "industries" not in items[0].tags  # Empty list excluded

    # Gaps should be generated for the other 2 subqueries
    assert len(gaps) == 2
    gap_categories = {g.category for g in gaps}
    assert "objective_funnel" in gap_categories  # Because the candidate was dropped
    assert "measurement_kpi" in gap_categories   # Because no candidate was returned for it
