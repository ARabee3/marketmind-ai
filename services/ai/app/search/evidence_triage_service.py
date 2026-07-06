from typing import Protocol

from app.search.schemas import EvidenceTriageRequest, EvidenceTriageResult


class EvidenceTriagePlanner(Protocol):
    async def triage(self, request: EvidenceTriageRequest) -> EvidenceTriageResult: ...


class EvidenceTriageService:
    def __init__(self, planner: EvidenceTriagePlanner) -> None:
        self.planner = planner

    async def triage(self, request: EvidenceTriageRequest) -> EvidenceTriageResult:
        return await self.planner.triage(request)
