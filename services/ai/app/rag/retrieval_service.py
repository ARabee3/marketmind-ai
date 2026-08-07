import asyncio
from datetime import datetime, timezone
from uuid import UUID, uuid4

from qdrant_client import AsyncQdrantClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.rag.errors import NonRetryableRetrievalError, RetryableRetrievalError
from app.rag.schemas import RetrievalQueryContext, RetrievedKnowledgePack, RetrievalCandidate
from app.rag.privacy import sanitize_query_context
from app.rag.query_builder import build_subqueries
from app.rag.filter_builder import build_category_filter
from app.rag.hydrator import hydrate_candidates
from app.rag.persistence import save_retrieval_run
from app.rag.mmr import MMRSelectionError
from app.rag.selection import select_retrieval_candidates
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
    persist: bool = True,
) -> RetrievedKnowledgePack:
    """Execute the full MarketMind filtered RAG pipeline.

    ``persist`` remains enabled for the existing Strategy endpoint. The
    Phase 2 orchestration tool can set it to ``False`` for a read-only shadow
    lookup, so an agent cannot create a second authoritative retrieval run.
    """
    start_time = datetime.now(timezone.utc)
    now_naive = start_time.replace(tzinfo=None)
    use_mmr = settings.rag_selection_mode == "semantic_mmr"
    
    # 1. Privacy Minimization
    sanitized_context = sanitize_query_context(query_context)
    
    # 2. Build Subqueries
    subqueries = build_subqueries(sanitized_context)
    
    # 3. Generate Embeddings for subquery texts
    embed_provider = EmbeddingProviderFactory.from_settings(settings)
    texts = [sq.text for sq in subqueries]
    embed_req = EmbedRequest(texts=texts, purpose="retrieval_query")
    try:
        embed_resp = await embed_provider.embed(embed_req)
    except Exception as e:
        raise RetryableRetrievalError(f"Embedding provider failed: {e}") from e
    vectors = [emb.vector for emb in embed_resp.embeddings]
    
    # 4. Execute Qdrant Searches (parallel)
    async def _search_one(sq_index: int) -> list[RetrievalCandidate]:
        sq = subqueries[sq_index]
        vector = vectors[sq_index]
        q_filter = build_category_filter(sq, now_naive)
        try:
            search_res = await qdrant_client.query_points(
                collection_name=settings.qdrant_collection_name,
                query=vector,
                query_filter=q_filter,
                limit=12,
                with_payload=True,
                with_vectors=use_mmr,
            )
        except Exception as e:
            raise RetryableRetrievalError(f"Qdrant search failed: {e}") from e

        results = []
        for point in search_res.points:
            payload = point.payload or {}
            raw_vector = getattr(point, "vector", None)
            if isinstance(raw_vector, dict):
                # Named-vector collections are not currently configured, but
                # accepting their single-vector shape keeps the opt-in path
                # explicit instead of silently dropping vector evidence.
                raw_vector = next(iter(raw_vector.values()), None)
            candidate_vector = (
                [float(value) for value in raw_vector]
                if raw_vector is not None
                else None
            )
            results.append(
                RetrievalCandidate(
                    # Qdrant point ids are deterministic derived index ids
                    # (`uuid5(chunk_id#entry_version)`). PostgreSQL hydration
                    # must use the canonical chunk id stored in the payload.
                    chunk_id=UUID(str(payload["chunk_id"])),
                    entry_id=UUID(payload["entry_id"]),
                    entry_version=payload["entry_version"],
                    score=point.score,
                    payload=payload,
                    subquery_category=sq.category,
                    vector=candidate_vector,
                )
            )
        return results

    nested = await asyncio.gather(*[_search_one(i) for i in range(len(subqueries))])
    qdrant_candidates = [c for sublist in nested for c in sublist]
            
    # 5. Regional preference, optional MMR, then the existing dedup/cap.
    # This pure selector is also used by the evaluation runner so its ranked
    # metrics describe the same candidate pack that reaches Strategy.
    try:
        regional_cands = select_retrieval_candidates(
            qdrant_candidates,
            requested_market=sanitized_context.market,
            selection_mode=settings.rag_selection_mode,
            query_vectors_by_category=(
                {
                    subquery.category: vectors[index]
                    for index, subquery in enumerate(subqueries)
                }
                if use_mmr
                else None
            ),
            mmr_lambda=settings.rag_mmr_lambda,
        )
    except MMRSelectionError as exc:
        # A configured MMR run must fail visibly if Qdrant does not return
        # comparable vectors. Falling back silently would invalidate the
        # semantic-vs-MMR comparison and hide a production misconfiguration.
        raise NonRetryableRetrievalError(
            f"MMR selection could not be completed safely: {exc}"
        ) from exc
    
    # 7. PostgreSQL Hydration & Gap Detection
    hydrated_items, knowledge_gaps = await hydrate_candidates(
        db_session, regional_cands, subqueries, now_naive
    )
    selected_items = hydrated_items
        
    end_time = datetime.now(timezone.utc)
    latency_ms = int((end_time - start_time).total_seconds() * 1000)
    
    run_id = uuid4()
    
    retrieval_metadata = {
        "embedding_provider": settings.embedding_provider_mode,
        "embedding_model": settings.embedding_model,
        "embedding_dimensions": settings.embedding_dimensions,
        "collection_name": settings.qdrant_collection_name,
        "retrieval_latency_ms": latency_ms,
        "selection_mode": settings.rag_selection_mode,
        "mmr_lambda": settings.rag_mmr_lambda,
        "candidate_count_before_cap": len(qdrant_candidates),
        "candidate_count_after_cap": len(regional_cands),
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
    
    # 8. Persist Run for the existing Strategy path. Shadow/orchestration
    # lookups intentionally return the same typed pack without a domain write.
    if persist:
        await save_retrieval_run(db_session, strategy_id, pack)
        await db_session.commit()
    
    return pack
