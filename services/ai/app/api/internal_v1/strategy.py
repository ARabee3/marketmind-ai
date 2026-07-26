from typing import AsyncGenerator
from uuid import UUID

from fastapi import APIRouter, Body, Depends, HTTPException
from pydantic import BaseModel
from qdrant_client import AsyncQdrantClient
from sqlalchemy.ext.asyncio import AsyncSession

from strategy_contracts import (
    BudgetScenario,
    BusinessProfilePayload,
    DeterministicChannelScorecard,
    KpiTarget,
    StrategyBrief,
)

from app.core.config import Settings, get_settings
from app.db.client import get_db
from app.decisions.errors import DecisionRuleInputError
from app.decisions.explanations import ChannelScoreExplanation, StrategyDecisionBundle
from app.decisions.service import compute_strategy_decisions
from app.qdrant.client import create_qdrant_client
from app.rag.errors import RetryableRetrievalError, NonRetryableRetrievalError
from app.rag.schemas import KnowledgeGap, RetrievalQueryContext, RetrievedKnowledgePack
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
    except RetryableRetrievalError as e:
        raise HTTPException(
            status_code=503,
            detail={"error_type": "retryable", "message": e.message},
        )
    except NonRetryableRetrievalError as e:
        raise HTTPException(
            status_code=400,
            detail={"error_type": "non_retryable", "message": e.message},
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail={"error_type": "unknown", "message": str(e)},
        )


class ScoreStrategyRequest(BaseModel):
    """Request body for deterministic strategy scoring."""

    business_profile: BusinessProfilePayload
    brief: StrategyBrief
    retrieval_pack: RetrievedKnowledgePack


class ScoreStrategyResponse(BaseModel):
    """Response body for deterministic strategy scoring."""

    deterministic_channel_scores: list[DeterministicChannelScorecard]
    selected_channels: list[DeterministicChannelScorecard]
    channel_explanations: list[ChannelScoreExplanation]
    budget_scenarios: list[BudgetScenario] | None
    kpi_targets: list[KpiTarget]
    knowledge_gaps: list[KnowledgeGap]


@router.post(
    "/score",
    response_model=ScoreStrategyResponse,
    summary="Score Strategy Deterministically",
    description="Runs the deterministic channel scoring, selection, budget, and KPI pipeline.",
)
async def score_strategy(
    request: ScoreStrategyRequest = Body(...),
) -> ScoreStrategyResponse:
    """Run deterministic strategy scoring without LLM generation."""
    try:
        bundle = compute_strategy_decisions(
            business_profile=request.business_profile,
            brief=request.brief,
            retrieval_pack=request.retrieval_pack,
        )
    except DecisionRuleInputError as e:
        raise HTTPException(
            status_code=400,
            detail={
                "error_type": "invalid_input",
                "field": e.field,
                "message": e.message,
            },
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail={"error_type": "unknown", "message": str(e)},
        )

    return ScoreStrategyResponse(
        deterministic_channel_scores=bundle.channel_scorecards,
        selected_channels=bundle.selected_channels,
        channel_explanations=bundle.channel_explanations,
        budget_scenarios=bundle.budget_scenarios,
        kpi_targets=bundle.kpi_targets,
        knowledge_gaps=bundle.knowledge_gaps,
    )
