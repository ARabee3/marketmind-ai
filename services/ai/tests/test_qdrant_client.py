from datetime import datetime, timezone
from uuid import uuid4

import pytest
from qdrant_client.models import Filter, FieldCondition, MatchValue

from app.embeddings import EmbedRequest, get_embedding_provider
from app.qdrant import (
    QdrantCollectionError,
    QdrantKnowledgePoint,
    collection_exists,
    count_points,
    create_collection,
    create_payload_indexes,
    delete_collection,
    delete_points_by_chunk_ids,
    ensure_collection,
    get_collection_info,
    search_points,
    upsert_points,
    validate_collection_compatibility,
)


pytestmark = pytest.mark.anyio


@pytest.mark.integration
async def test_create_and_delete_collection(
    qdrant_test_client, test_collection_name: str
) -> None:
    assert not await collection_exists(qdrant_test_client, test_collection_name)
    await create_collection(qdrant_test_client, test_collection_name, vector_size=3072)
    assert await collection_exists(qdrant_test_client, test_collection_name)
    info = await get_collection_info(qdrant_test_client, test_collection_name)
    assert info["vector_size"] == 3072
    await delete_collection(qdrant_test_client, test_collection_name)
    assert not await collection_exists(qdrant_test_client, test_collection_name)


@pytest.mark.integration
async def test_ensure_collection_creates_when_missing(
    qdrant_test_client, test_collection_name: str
) -> None:
    name = await ensure_collection(qdrant_test_client, test_collection_name, 3072)
    assert name == test_collection_name
    assert await collection_exists(qdrant_test_client, test_collection_name)


@pytest.mark.integration
async def test_payload_indexes_are_created(
    qdrant_test_client, test_collection_name: str
) -> None:
    await create_collection(qdrant_test_client, test_collection_name, vector_size=3072)
    await create_payload_indexes(qdrant_test_client, test_collection_name)
    info = await get_collection_info(qdrant_test_client, test_collection_name)
    assert info["status"] is not None


@pytest.mark.integration
async def test_upsert_and_search_roundtrip(
    qdrant_test_client, test_collection_name: str
) -> None:
    provider = get_embedding_provider()
    await create_collection(qdrant_test_client, test_collection_name, vector_size=3072)
    await create_payload_indexes(qdrant_test_client, test_collection_name)

    chunk_id = uuid4()
    entry_id = uuid4()
    text = "Small Egyptian cafés can use Instagram to show daily specials."
    embedding = await provider.embed(EmbedRequest(texts=[text]))
    point = QdrantKnowledgePoint(
        chunk_id=chunk_id,
        entry_id=entry_id,
        entry_version=1,
        checksum="abc123",
        text=text,
        kind="channel_playbook",
        locale="en",
        markets=["egypt"],
        industries=["hospitality"],
        channels=["instagram"],
        evidence_tier="reviewed_guidance",
        review_status="approved",
        effective_at=datetime.now(timezone.utc),
    )
    await upsert_points(
        qdrant_test_client,
        test_collection_name,
        [(point, embedding.embeddings[0].vector)],
    )

    results = await search_points(
        qdrant_test_client,
        test_collection_name,
        vector=embedding.embeddings[0].vector,
        limit=5,
    )
    assert len(results) == 1
    assert results[0].payload["chunk_id"] == str(chunk_id)
    assert results[0].payload["text"] == text


@pytest.mark.integration
async def test_filtered_search(
    qdrant_test_client, test_collection_name: str
) -> None:
    provider = get_embedding_provider()
    await create_collection(qdrant_test_client, test_collection_name, vector_size=3072)
    await create_payload_indexes(qdrant_test_client, test_collection_name)

    texts = ["Instagram for cafés", "Facebook for retail"]
    embeddings = await provider.embed(EmbedRequest(texts=texts))
    for idx, text in enumerate(texts):
        channel = "instagram" if idx == 0 else "facebook"
        point = QdrantKnowledgePoint(
            chunk_id=uuid4(),
            entry_id=uuid4(),
            entry_version=1,
            checksum=f"chk{idx}",
            text=text,
            kind="channel_playbook",
            locale="en",
            channels=[channel],
            evidence_tier="reviewed_guidance",
            review_status="approved",
            effective_at=datetime.now(timezone.utc),
        )
        await upsert_points(
            qdrant_test_client,
            test_collection_name,
            [(point, embeddings.embeddings[idx].vector)],
        )

    query = await provider.embed(EmbedRequest(texts=["Instagram tips"]))
    query_filter = Filter(
        must=[
            FieldCondition(
                key="channels",
                match=MatchValue(value="instagram"),
            ),
            FieldCondition(
                key="review_status",
                match=MatchValue(value="approved"),
            ),
        ]
    )
    results = await search_points(
        qdrant_test_client,
        test_collection_name,
        vector=query.embeddings[0].vector,
        query_filter=query_filter,
        limit=5,
    )
    assert len(results) == 1
    assert results[0].payload["channels"] == ["instagram"]


@pytest.mark.integration
async def test_idempotent_upsert(
    qdrant_test_client, test_collection_name: str
) -> None:
    provider = get_embedding_provider()
    await create_collection(qdrant_test_client, test_collection_name, vector_size=3072)

    chunk_id = uuid4()
    entry_id = uuid4()
    text = "Consistent point id."
    embedding = await provider.embed(EmbedRequest(texts=[text]))
    point = QdrantKnowledgePoint(
        chunk_id=chunk_id,
        entry_id=entry_id,
        entry_version=1,
        checksum="v1",
        text=text,
        kind="foundation",
        locale="en",
        evidence_tier="reviewed_guidance",
        review_status="approved",
        effective_at=datetime.now(timezone.utc),
    )
    await upsert_points(
        qdrant_test_client,
        test_collection_name,
        [(point, embedding.embeddings[0].vector)],
    )
    await upsert_points(
        qdrant_test_client,
        test_collection_name,
        [(point, embedding.embeddings[0].vector)],
    )

    count = await count_points(qdrant_test_client, test_collection_name)
    assert count == 1


@pytest.mark.integration
async def test_delete_points_by_chunk_ids(
    qdrant_test_client, test_collection_name: str
) -> None:
    provider = get_embedding_provider()
    await create_collection(qdrant_test_client, test_collection_name, vector_size=3072)

    chunk_id = uuid4()
    entry_id = uuid4()
    embedding = await provider.embed(EmbedRequest(texts=["delete me"]))
    point = QdrantKnowledgePoint(
        chunk_id=chunk_id,
        entry_id=entry_id,
        entry_version=1,
        checksum="del",
        text="delete me",
        kind="foundation",
        locale="en",
        evidence_tier="reviewed_guidance",
        review_status="approved",
        effective_at=datetime.now(timezone.utc),
    )
    await upsert_points(
        qdrant_test_client,
        test_collection_name,
        [(point, embedding.embeddings[0].vector)],
    )
    assert await count_points(qdrant_test_client, test_collection_name) == 1

    await delete_points_by_chunk_ids(
        qdrant_test_client, test_collection_name, [chunk_id], entry_version=1
    )
    assert await count_points(qdrant_test_client, test_collection_name) == 0


@pytest.mark.integration
async def test_dimension_mismatch_guard(
    qdrant_test_client, test_collection_name: str
) -> None:
    await create_collection(qdrant_test_client, test_collection_name, vector_size=768)
    with pytest.raises(QdrantCollectionError) as exc_info:
        await validate_collection_compatibility(
            qdrant_test_client, test_collection_name, expected_size=3072
        )
    assert "vector size 768" in str(exc_info.value)
    assert "configured dimensions are 3072" in str(exc_info.value)
