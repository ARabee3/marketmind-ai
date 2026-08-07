"""Typed inputs and outputs for the Phase 2 least-privilege tools."""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import Field

from content_base import FrozenModel
from orchestration_contracts import (
    ResearchFactV1,
    ResearchKnowledgeGapV1,
    UUID as ContractUUID,
)

from app.discovery.schemas import LanguageMode


KnowledgeFocus = Literal[
    "framework_diagnosis",
    "objective_funnel",
    "channels",
    "budget_method",
    "measurement_kpi",
    "content_strategy",
    "market_sector_season",
]


class ApprovedKnowledgeSearchArgs(FrozenModel):
    """Model-controlled focus only; scope and retrieval credentials are server-owned."""

    focus_category: KnowledgeFocus | None = None
    max_results: int = Field(default=8, ge=1, le=12)


class ApprovedKnowledgeSearchResult(FrozenModel):
    retrieval_run_id: ContractUUID
    facts: list[ResearchFactV1]
    knowledge_gaps: list[ResearchKnowledgeGapV1]


class PlanTrustedResearchQueriesArgs(FrozenModel):
    language_mode: LanguageMode = "mixed"


class TriageResearchEvidenceArgs(FrozenModel):
    """Selects indexes from the server-provided Discovery evidence set."""

    candidate_indices: list[Annotated[int, Field(ge=0)]] = Field(
        min_length=1, max_length=40
    )
    language_mode: LanguageMode = "mixed"


class CalculateStrategyDecisionsArgs(FrozenModel):
    """The deterministic inputs are never accepted from the model."""

    explain: bool = True
