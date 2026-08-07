"""Phase 2 tool and Research Agent boundary.

This package is intentionally not imported by ``app.main`` yet. It is a
shadow-safe building block for the later LangGraph graph.
"""

from .contracts import (
    ApprovedKnowledgeSearchArgs,
    ApprovedKnowledgeSearchResult,
    CalculateStrategyDecisionsArgs,
    PlanTrustedResearchQueriesArgs,
    TriageResearchEvidenceArgs,
)
from .registry import (
    ResearchToolContext,
    TOOL_NAMES,
    ToolBudget,
    ToolDefinition,
    ToolExecutionError,
    ToolRegistry,
)
from .builtins import Phase2ToolServices, create_phase2_tool_registry
from .research_agent import (
    DeterministicResearchSelector,
    ResearchAgent,
    ResearchAgentInput,
    ResearchAgentResult,
    ResearchContextBuilder,
    ResearchAgentView,
    StopDecision,
    ToolSelection,
)

__all__ = [
    "ApprovedKnowledgeSearchArgs",
    "ApprovedKnowledgeSearchResult",
    "CalculateStrategyDecisionsArgs",
    "PlanTrustedResearchQueriesArgs",
    "ResearchToolContext",
    "TOOL_NAMES",
    "ToolBudget",
    "ToolDefinition",
    "ToolExecutionError",
    "ToolRegistry",
    "TriageResearchEvidenceArgs",
    "Phase2ToolServices",
    "create_phase2_tool_registry",
    "DeterministicResearchSelector",
    "ResearchAgent",
    "ResearchAgentInput",
    "ResearchAgentResult",
    "ResearchContextBuilder",
    "ResearchAgentView",
    "StopDecision",
    "ToolSelection",
]
