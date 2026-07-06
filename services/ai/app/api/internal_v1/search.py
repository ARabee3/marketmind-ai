from fastapi import APIRouter, Depends

from app.core.config import Settings, get_settings
from app.search.evidence_triage_service import EvidenceTriageService
from app.search.llm_evidence_triage import create_evidence_triage_planner
from app.search.llm_query_planner import create_llm_query_planner
from app.search.query_planning_service import QueryPlanningService
from app.search.schemas import (
    EvidenceTriageRequest,
    EvidenceTriageResult,
    QueryPlan,
    QueryPlanningRequest,
)

router = APIRouter(prefix="/internal/v1/ai/search", tags=["internal-ai-search"])


def get_query_planning_service(
    settings: Settings = Depends(get_settings),
) -> QueryPlanningService:
    return QueryPlanningService(create_llm_query_planner(settings))


def get_evidence_triage_service(
    settings: Settings = Depends(get_settings),
) -> EvidenceTriageService:
    return EvidenceTriageService(create_evidence_triage_planner(settings))


@router.post("/query-plan", response_model=QueryPlan)
async def query_plan(
    request: QueryPlanningRequest,
    service: QueryPlanningService = Depends(get_query_planning_service),
) -> QueryPlan:
    return await service.plan(request)


@router.post("/evidence-triage", response_model=EvidenceTriageResult)
async def evidence_triage(
    request: EvidenceTriageRequest,
    service: EvidenceTriageService = Depends(get_evidence_triage_service),
) -> EvidenceTriageResult:
    return await service.triage(request)
