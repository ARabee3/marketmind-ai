"""Phase 3 Strategy orchestration boundary.

The package is shadow-safe: importing it does not mount routes, create a
database connection, or enable orchestration.  A caller must explicitly inject
the LangGraph checkpointer and provider before starting a run.
"""

from .checksum import canonical_json_checksum, strategy_plan_checksum
from .contracts import (
    Phase3InputV1,
    PreparedPhase3InputV1,
    ResearchStrategyHandoffV1,
    StrategyApprovalInterruptV1,
    StrategyDraftPersistenceReceiptV1,
    StrategyDraftHandoffV1,
    StrategyQualityReviewV1,
)
from .graph import (
    Phase3GraphState,
    Phase3ResumeResult,
    Phase3RunError,
    Phase3Runner,
    Phase3StartResult,
    build_phase3_graph,
)
from .preparation import Phase3PreparationError, prepare_phase3_input
from .strategy_segment import (
    DeterministicStrategyQualityReviewer,
    Phase3GenerationError,
    StrategyGenerationResult,
    StrategySegment,
)

__all__ = [
    "canonical_json_checksum",
    "strategy_plan_checksum",
    "Phase3InputV1",
    "PreparedPhase3InputV1",
    "ResearchStrategyHandoffV1",
    "StrategyApprovalInterruptV1",
    "StrategyDraftPersistenceReceiptV1",
    "StrategyDraftHandoffV1",
    "StrategyQualityReviewV1",
    "Phase3GraphState",
    "Phase3ResumeResult",
    "Phase3RunError",
    "Phase3Runner",
    "Phase3StartResult",
    "build_phase3_graph",
    "Phase3PreparationError",
    "prepare_phase3_input",
    "DeterministicStrategyQualityReviewer",
    "Phase3GenerationError",
    "StrategyGenerationResult",
    "StrategySegment",
]
