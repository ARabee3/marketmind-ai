from fastapi import APIRouter, Depends

from app.core.config import Settings, get_settings
from app.search.llm_query_planner import create_llm_query_planner
from app.search.query_planning_service import QueryPlanningService
from app.search.schemas import QueryPlan, QueryPlanningRequest

router = APIRouter(prefix="/internal/v1/ai/search", tags=["internal-ai-search"])


def get_query_planning_service(
    settings: Settings = Depends(get_settings),
) -> QueryPlanningService:
    return QueryPlanningService(create_llm_query_planner(settings))


@router.post("/query-plan", response_model=QueryPlan)
async def query_plan(
    request: QueryPlanningRequest,
    service: QueryPlanningService = Depends(get_query_planning_service),
) -> QueryPlan:
    return await service.plan(request)
