"""Adapt the contract-level RetrievedKnowledgePack to the RAG service shape.

The internal AI generation endpoint receives the typed contract pack from NestJS,
but the existing deterministic decision pipeline expects the `app.rag.schemas`
hydrated pack. This adapter performs the lossless conversion without mutating
source data.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from strategy_contracts import (
    RetrievedKnowledgePack as ContractPack,
    RetrievedKnowledgeItem as ContractItem,
)

from app.rag.schemas import (
    HydratedItem,
    KnowledgeGap,
    RetrievedKnowledgePack,
)


def contract_item_to_hydrated(item: ContractItem) -> HydratedItem:
    """Convert a contract retrieved item to the RAG HydratedItem shape."""
    return HydratedItem(
        chunk_id=UUID(item.chunk_id) if isinstance(item.chunk_id, str) else item.chunk_id,
        entry_id=UUID(item.entry_id) if isinstance(item.entry_id, str) else item.entry_id,
        entry_version=item.entry_version,
        title=item.title,
        excerpt=item.excerpt,
        kind=item.kind,
        tags=item.tags,
        relevance_score=item.relevance_score,
        evidence_tier=item.source_quality.evidence_tier,
        source_references=item.source_quality.source_references,
        effective_at=item.source_quality.effective_at,
        expires_at=item.source_quality.expires_at,
        review_status=item.source_quality.review_status,
        market_tier=item.market_tier,
        is_fallback=item.is_fallback,
        fallback_label=item.fallback_label,
        category=item.kind,
    )


def contract_pack_to_rag(pack: ContractPack) -> RetrievedKnowledgePack:
    """Convert a contract RetrievedKnowledgePack to the RAG service shape."""
    retrieval_metadata: dict[str, Any] = pack.retrieval_metadata.model_dump(mode="json")
    return RetrievedKnowledgePack(
        retrieval_run_id=UUID(pack.retrieval_run_id)
        if isinstance(pack.retrieval_run_id, str)
        else pack.retrieval_run_id,
        query_summary=pack.query_summary,
        query_context=pack.query_context.model_dump(mode="json"),
        profile_version_id=UUID(pack.profile_version_id)
        if isinstance(pack.profile_version_id, str)
        else pack.profile_version_id,
        brief_id=UUID(pack.brief_id) if isinstance(pack.brief_id, str) else pack.brief_id,
        items=[contract_item_to_hydrated(item) for item in pack.items],
        knowledge_gaps=[
            KnowledgeGap(
                category=gap.category,
                description=gap.description,
                severity=gap.severity,
            )
            for gap in pack.knowledge_gaps
        ],
        retrieval_metadata=retrieval_metadata,
        retrieved_at=pack.retrieved_at,
    )



