from fastapi import APIRouter, Depends

from app.search.query_planning_service import QueryPlanningService
from app.search.schemas import QueryPlan, QueryPlanningRequest

router = APIRouter(prefix="/internal/v1/ai/search", tags=["internal-ai-search"])


def get_query_planning_service() -> QueryPlanningService:
    return QueryPlanningService()


@router.post("/query-plan", response_model=QueryPlan)
async def query_plan(
    request: QueryPlanningRequest,
    service: QueryPlanningService = Depends(get_query_planning_service),
) -> QueryPlan:
    return service.plan(request)
