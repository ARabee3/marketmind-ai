"""Shared final candidate selection for Strategy retrieval and evaluation."""

from app.core.config import RagSelectionMode
from app.rag.dedup import deduplicate_and_cap
from app.rag.mmr import MMRSelectionError, reorder_regional_candidates_with_mmr
from app.rag.regional import apply_regional_preference
from app.rag.schemas import RegionalCandidate, RetrievalCandidate


def select_retrieval_candidates(
    candidates: list[RetrievalCandidate],
    *,
    requested_market: str,
    selection_mode: RagSelectionMode,
    query_vectors_by_category: dict[str, list[float]] | None = None,
    mmr_lambda: float = 0.5,
) -> list[RegionalCandidate]:
    """Apply the exact final selection order used by Strategy retrieval.

    Qdrant filtering and candidate generation happen before this function. The
    shared boundary intentionally covers regional preference, optional MMR, and
    the existing category-preserving dedup/cap step so evaluation measures the
    same pack order that reaches hydration and Strategy generation.
    """

    regional_candidates = apply_regional_preference(candidates, requested_market)

    if selection_mode == "semantic_mmr":
        if query_vectors_by_category is None:
            raise MMRSelectionError(
                "MMR selection requires query vectors for every candidate category"
            )
        regional_candidates = reorder_regional_candidates_with_mmr(
            regional_candidates,
            query_vectors_by_category,
            requested_market=requested_market,
            lambda_mult=mmr_lambda,
        )

    return deduplicate_and_cap(regional_candidates)
