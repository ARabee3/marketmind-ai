from datetime import datetime, timezone
from uuid import uuid4

import pytest

from app.qdrant.schemas import QdrantKnowledgePoint


def test_qdrant_knowledge_point_does_not_accept_business_profile_fields() -> None:
    """Business Profile data must never enter the shared Qdrant collection."""
    base = {
        "chunk_id": uuid4(),
        "entry_id": uuid4(),
        "entry_version": 1,
        "checksum": "abc123",
        "text": "Marketing guidance for small cafés.",
        "kind": "channel_playbook",
        "locale": "en",
        "evidence_tier": "reviewed_guidance",
        "review_status": "approved",
        "effective_at": datetime.now(timezone.utc),
    }

    # Valid payload should work.
    point = QdrantKnowledgePoint(**base)
    assert point.to_payload()

    # Adding a Business Profile field should be rejected.
    with pytest.raises(ValueError):
        QdrantKnowledgePoint(**base, business_name="Koshary Corner")

    with pytest.raises(ValueError):
        QdrantKnowledgePoint(**base, owner_email="owner@example.com")

    with pytest.raises(ValueError):
        QdrantKnowledgePoint(**base, business_profile_id=uuid4())
