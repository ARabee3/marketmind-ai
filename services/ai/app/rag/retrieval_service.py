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
    
    # 6. PostgreSQL Hydration & Gap Detection
    # Note: Hydrator receives the sorted candidates to preserve preference
    hydrated_items, knowledge_gaps = await hydrate_candidates(
        db_session, regional_cands, subqueries, now_naive
    )
    
    # Re-wrap hydrated items into pseudo-candidates for dedup to work on
    # Dedup expects RegionalCandidate, but we have HydratedItem.
    # Actually, we should dedup BEFORE hydrating to save DB hits!
    # Wait, if we dedup before, we might drop valid fallbacks if a better item gets dropped during hydration (e.g. out of sync).
    # But Qdrant being out-of-sync is rare. Let's hydrate first to get actual DB items,
    # then dedup the HydratedItems. But dedup_and_cap takes RegionalCandidates.
    # I'll adapt dedup_and_cap or write a quick loop here:
    selected_items = []
    seen_chunks = set()
    entry_counts = {}
    
    for item in hydrated_items:
        if len(selected_items) >= 8:
            break
        if item.chunk_id in seen_chunks:
            continue
        if entry_counts.get(item.entry_id, 0) >= 2:
            continue
            
        selected_items.append(item)
        seen_chunks.add(item.chunk_id)
        entry_counts[item.entry_id] = entry_counts.get(item.entry_id, 0) + 1
        
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
    
    # 7. Persist Run
    await save_retrieval_run(db_session, strategy_id, pack)
    await db_session.commit()
    
    return pack
