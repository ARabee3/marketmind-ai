"""Allow-listed, bounded execution for Research Agent tools."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, Generic, Mapping, TypeVar

from pydantic import BaseModel, ValidationError

from error_codes import ERROR_CODES
from orchestration_contracts import CampaignOrchestrationStartV1

from app.core.config import Settings
from app.discovery.schemas import PreparedDiscoveryIntake
from app.rag.schemas import RetrievedKnowledgePack, RetrievalQueryContext
from app.search.schemas import EvidenceTriageCandidate
from strategy_contracts import BusinessProfilePayload, StrategyBrief

from .contracts import (
    ApprovedKnowledgeSearchArgs,
    ApprovedKnowledgeSearchResult,
    CalculateStrategyDecisionsArgs,
    PlanTrustedResearchQueriesArgs,
    TriageResearchEvidenceArgs,
)

TOOL_NAMES = (
    "search_approved_marketing_knowledge",
    "plan_trusted_research_queries",
    "triage_research_evidence",
    "calculate_strategy_decisions",
)
ToolName = str

InputModel = TypeVar("InputModel", bound=BaseModel)
OutputModel = TypeVar("OutputModel", bound=BaseModel)


class ToolExecutionError(Exception):
    """A visible, stable tool boundary failure."""

    def __init__(self, code: str, message: str, *, retryable: bool = False) -> None:
        if code not in ERROR_CODES:
            raise ValueError(f"Unknown orchestration error code: {code}")
        self.code = code
        self.retryable = retryable
        super().__init__(message)


@dataclass(frozen=True)
class ResearchToolContext:
    """Server-built context; model arguments cannot replace these values."""

    start: CampaignOrchestrationStartV1
    intake: PreparedDiscoveryIntake
    discovery_candidates: tuple[EvidenceTriageCandidate, ...] = ()
    retrieval_query_context: RetrievalQueryContext | None = None
    business_profile: BusinessProfilePayload | None = None
    strategy_brief: StrategyBrief | None = None
    retrieval_pack: RetrievedKnowledgePack | None = None
    settings: Settings | None = None
    db_session: Any | None = None
    qdrant_client: Any | None = None


@dataclass
class ToolBudget:
    """Run-local call budget shared by every registry invocation."""

    limit: int
    used: int = 0

    def __post_init__(self) -> None:
        if self.limit < 0 or self.used < 0 or self.used > self.limit:
            raise ValueError("Tool budget must satisfy 0 <= used <= limit.")

    def consume(self) -> None:
        if self.used >= self.limit:
            raise ToolExecutionError(
                "ORCHESTRATION_BUDGET_EXCEEDED",
                f"Tool-call budget exhausted ({self.used}/{self.limit}).",
            )
        self.used += 1


@dataclass(frozen=True)
class ToolExecution(Generic[OutputModel]):
    tool_name: str
    result: OutputModel
    started_at: datetime
    finished_at: datetime


Handler = Callable[[InputModel, ResearchToolContext], Awaitable[OutputModel]]


@dataclass(frozen=True)
class ToolDefinition(Generic[InputModel, OutputModel]):
    name: str
    description: str
    input_model: type[InputModel]
    output_model: type[OutputModel]
    handler: Handler
    timeout_seconds: float = 30.0

    def __post_init__(self) -> None:
        if self.timeout_seconds <= 0:
            raise ValueError("Tool timeout must be positive.")


class ToolRegistry:
    """Executes only reviewed tools and validates both sides of the boundary."""

    def __init__(
        self,
        definitions: tuple[ToolDefinition[Any, Any], ...],
        *,
        max_output_bytes: int = 32_000,
    ) -> None:
        if max_output_bytes <= 0:
            raise ValueError("max_output_bytes must be positive.")
        names = [definition.name for definition in definitions]
        if len(set(names)) != len(names):
            raise ValueError("Tool names must be unique.")
        self._definitions = {definition.name: definition for definition in definitions}
        self.max_output_bytes = max_output_bytes

    @property
    def names(self) -> tuple[str, ...]:
        return tuple(self._definitions)

    def describe(self) -> tuple[dict[str, str], ...]:
        """Return safe metadata only; handlers and credentials never leave the process."""

        return tuple(
            {"name": definition.name, "description": definition.description}
            for definition in self._definitions.values()
        )

    async def execute(
        self,
        name: str,
        arguments: Mapping[str, Any],
        context: ResearchToolContext,
        budget: ToolBudget,
    ) -> ToolExecution[Any]:
        definition = self._definitions.get(name)
        if definition is None:
            raise ToolExecutionError(
                "ORCHESTRATION_TOOL_NOT_ALLOWED",
                f"Tool '{name}' is not in the reviewed allow-list.",
            )

        budget.consume()
        started_at = datetime.now(timezone.utc)
        try:
            parsed = definition.input_model.model_validate(dict(arguments))
        except (TypeError, ValueError, ValidationError) as exc:
            raise ToolExecutionError(
                "ORCHESTRATION_VALIDATION_FAILED",
                f"Invalid arguments for tool '{name}': {exc}",
            ) from exc

        try:
            async with asyncio.timeout(definition.timeout_seconds):
                raw_result = await definition.handler(parsed, context)
            result = definition.output_model.model_validate(raw_result)
        except TimeoutError as exc:
            raise ToolExecutionError(
                "ORCHESTRATION_PROVIDER_UNSUPPORTED",
                f"Tool '{name}' exceeded its per-call timeout.",
                retryable=True,
            ) from exc
        except ToolExecutionError:
            raise
        except ValidationError as exc:
            raise ToolExecutionError(
                "ORCHESTRATION_VALIDATION_FAILED",
                f"Tool '{name}' returned an invalid result: {exc}",
            ) from exc
        except Exception as exc:
            raise ToolExecutionError(
                "ORCHESTRATION_VALIDATION_FAILED",
                f"Tool '{name}' failed with a classified boundary error: {exc}",
                retryable=True,
            ) from exc

        encoded_size = len(result.model_dump_json().encode("utf-8"))
        if encoded_size > self.max_output_bytes:
            raise ToolExecutionError(
                "ORCHESTRATION_BUDGET_EXCEEDED",
                f"Tool '{name}' returned {encoded_size} bytes; the cap is {self.max_output_bytes}.",
            )

        return ToolExecution(
            tool_name=name,
            result=result,
            started_at=started_at,
            finished_at=datetime.now(timezone.utc),
        )


def tool_definitions_for_types() -> tuple[type[BaseModel], ...]:
    """Small introspection hook used by contract tests and documentation checks."""

    return (
        ApprovedKnowledgeSearchArgs,
        PlanTrustedResearchQueriesArgs,
        TriageResearchEvidenceArgs,
        CalculateStrategyDecisionsArgs,
    )
