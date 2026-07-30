from types import SimpleNamespace
from uuid import uuid4

import pytest

import app.rag.retrieval_service as retrieval_module
from app.core.config import Settings
from app.rag.retrieval_service import retrieve_strategy_knowledge
from app.rag.schemas import RetrievalQueryContext


@pytest.mark.asyncio
async def test_retrieval_hydrates_with_payload_chunk_id_not_derived_point_id(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    canonical_chunk_id = uuid4()
    derived_qdrant_point_id = uuid4()
    entry_id = uuid4()
    captured_chunk_ids = []

    class QdrantStub:
        async def query_points(self, **_kwargs):
            return SimpleNamespace(
                points=[
                    SimpleNamespace(
                        id=derived_qdrant_point_id,
                        score=0.91,
                        payload={
                            "chunk_id": str(canonical_chunk_id),
                            "entry_id": str(entry_id),
                            "entry_version": 1,
                            "markets": ["egypt"],
                        },
                    )
                ]
            )

    async def capture_hydration(_session, candidates, subqueries, _now):
        captured_chunk_ids.extend(
            candidate.candidate.chunk_id for candidate in candidates
        )
        return [], []

    async def no_op_save(*_args, **_kwargs):
        return None

    monkeypatch.setattr(
        retrieval_module,
        "hydrate_candidates",
        capture_hydration,
    )
    monkeypatch.setattr(
        retrieval_module,
        "save_retrieval_run",
        no_op_save,
    )

    db_session = SimpleNamespace(commit=no_op_save)
    settings = Settings(
        embedding_provider_mode="fake",
        embedding_model="fake-test",
        embedding_dimensions=16,
        qdrant_collection_name="test-knowledge",
    )

    await retrieve_strategy_knowledge(
        db_session=db_session,
        qdrant_client=QdrantStub(),
        settings=settings,
        strategy_id=uuid4(),
        brief_id=uuid4(),
        profile_version_id=uuid4(),
        query_context=RetrievalQueryContext(
            business_type="dessert shop",
            market="egypt",
            locale="ar-EG",
            objective="conversion",
            funnel_stage="conversion",
            active_channels=["facebook"],
            asset_capability=["photo"],
            team_capacity="owner plus one helper",
            budget_mode="organic_only",
            industry="hospitality",
            paid_media_allowed=False,
        ),
    )

    assert captured_chunk_ids == [canonical_chunk_id]
    assert derived_qdrant_point_id not in captured_chunk_ids
