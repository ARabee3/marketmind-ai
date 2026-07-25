from datetime import datetime, timezone
from uuid import UUID, uuid4

from qdrant_client import AsyncQdrantClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.rag.errors import RetryableRetrievalError
from app.rag.schemas import RetrievalQueryContext, RetrievedKnowledgePack, RetrievalCandidate
from app.rag.privacy import sanitize_query_context
from app.rag.query_builder import build_subqueries
from app.rag.filter_builder import build_category_filter
from app.rag.regional import apply_regional_preference
from app.rag.dedup import deduplicate_and_cap
from app.rag.hydrator import hydrate_candidates
from app.rag.persistence import save_retrieval_run
from app.embeddings.factory import EmbeddingProviderFactory
from app.embeddings import EmbedRequest


async def retrieve_strategy_knowledge(
    db_session: AsyncSession,
    qdrant_client: AsyncQdrantClient,
    settings: Settings,
    strategy_id: UUID,
    brief_id: UUID,
    profile_version_id: UUID,
    query_context: RetrievalQueryContext,
) -> RetrievedKnowledgePack:
    """Execute the full MarketMind filtered RAG pipeline."""
    start_time = datetime.now(timezone.utc)
    now_naive = start_time.replace(tzinfo=None)
    
    # 1. Privacy Minimization
    sanitized_context = sanitize_query_context(query_context)
    
    # 2. Build Subqueries
    subqueries = build_subqueries(sanitized_context)
    
    # 3. Generate Embeddings for subquery texts
    embed_provider = EmbeddingProviderFactory.from_settings(settings)
    texts = [sq.text for sq in subqueries]
    embed_req = EmbedRequest(texts=texts)
    embed_resp = await embed_provider.embed(embed_req)
    vectors = [emb.vector for emb in embed_resp.embeddings]
    
    # 4. Execute Qdrant Searches
    qdrant_candidates: list[RetrievalCandidate] = []
    # Can run in parallel using asyncio.gather, but doing sequentially for clarity
    for i, sq in enumerate(subqueries):
        vector = vectors[i]
        q_filter = build_category_filter(sq, now_naive)
        
        # Max 12 candidates per category per requirement
        try:
            search_res = await qdrant_client.query_points(
                collection_name=settings.qdrant_collection_name,
                query=vector,
                query_filter=q_filter,
                limit=12,
                with_payload=True,
            )
        except Exception as e:
            raise RetryableRetrievalError(f"Qdrant search failed: {e}") from e
        
        for point in search_res.points:
            payload = point.payload or {}
            cand = RetrievalCandidate(
                chunk_id=UUID(str(point.id)),
                entry_id=UUID(payload["entry_id"]),
                entry_version=payload["entry_version"],
                score=point.score,
                payload=payload,
                subquery_category=sq.category,
            )
            qdrant_candidates.append(cand)
            
    # 5. Regional Fallback Sort
    regional_cands = apply_regional_preference(qdrant_candidates, sanitized_context.market)
    
    # 6. Dedup before hydration: reduces DB queries and enforces caps early
    regional_cands = deduplicate_and_cap(regional_cands)
    
    # 7. PostgreSQL Hydration & Gap Detection
    hydrated_items, knowledge_gaps = await hydrate_candidates(
        db_session, regional_cands, subqueries, now_naive
    )
    selected_items = hydrated_items
        
    end_time = datetime.now(timezone.utc)
    latency_ms = int((end_time - start_time).total_seconds() * 1000)
    
    run_id = uuid4()
    
    retrieval_metadata = {
        "embedding_model": settings.embedding_model,
        "embedding_dimensions": settings.embedding_dimensions,
        "qdrant_collection": settings.qdrant_collection_name,
        "retrieval_latency_ms": latency_ms,
    }
    
    pack = RetrievedKnowledgePack(
        retrieval_run_id=run_id,
        query_summary=f"Strategy retrieval for {sanitized_context.business_type} in {sanitized_context.market}",
        query_context=sanitized_context.model_dump(),
        profile_version_id=profile_version_id,
        brief_id=brief_id,
        items=selected_items,
        knowledge_gaps=knowledge_gaps,
        retrieval_metadata=retrieval_metadata,
        retrieved_at=now_naive,
    )
    
    # 8. Persist Run
    await save_retrieval_run(db_session, strategy_id, pack)
    await db_session.commit()
    
    return pack
