from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from qdrant_client import AsyncQdrantClient
from sqlalchemy.ext.asyncio import AsyncSession

from typing import AsyncGenerator

from app.core.config import Settings, get_settings
from app.db.client import get_db
from app.qdrant.client import create_qdrant_client
from app.rag.schemas import RetrievalQueryContext, RetrievedKnowledgePack
from app.rag.retrieval_service import retrieve_strategy_knowledge


router = APIRouter(prefix="/internal/v1/ai/strategy", tags=["internal-ai-strategy"])


async def get_qdrant() -> AsyncGenerator[AsyncQdrantClient, None]:
    client = create_qdrant_client()
    try:
        yield client
    finally:
        await client.close()


@router.post(
    "/retrieve",
    response_model=RetrievedKnowledgePack,
    summary="Retrieve Strategy Knowledge",
    description="Retrieves a filtered, deduplicated, and privacy-scrubbed knowledge pack.",
)
async def retrieve_knowledge(
    strategy_id: UUID,
    brief_id: UUID,
    profile_version_id: UUID,
    query_context: RetrievalQueryContext,
    db_session: AsyncSession = Depends(get_db),
    qdrant_client: AsyncQdrantClient = Depends(get_qdrant),
    settings: Settings = Depends(get_settings),
) -> RetrievedKnowledgePack:
    """Retrieve marketing knowledge using the filtered RAG pipeline."""
    try:
        pack = await retrieve_strategy_knowledge(
            db_session=db_session,
            qdrant_client=qdrant_client,
            settings=settings,
            strategy_id=strategy_id,
            brief_id=brief_id,
            profile_version_id=profile_version_id,
            query_context=query_context,
        )
        return pack
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
