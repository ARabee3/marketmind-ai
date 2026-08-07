"""Deterministic maximal-marginal-relevance ordering for RAG candidates.

MMR is intentionally a second, opt-in selector. It reorders candidates within
the same retrieval category and regional tier; it never changes the filters,
hydration rules, or category-cap logic used by the semantic path.
"""

from __future__ import annotations

import math
from collections import defaultdict
from app.rag.schemas import RegionalCandidate, RetrievalCandidate


class MMRSelectionError(ValueError):
    """Raised when the MMR path cannot safely compare candidate vectors."""


def cosine_similarity(left: list[float], right: list[float]) -> float:
    """Return cosine similarity, rejecting vectors with incompatible shapes."""

    if len(left) != len(right):
        raise MMRSelectionError(
            "MMR vector dimensions differ: "
            f"candidate={len(left)}, comparison={len(right)}"
        )
    if not left:
        raise MMRSelectionError("MMR cannot compare empty vectors")

    left_norm = math.sqrt(sum(value * value for value in left))
    right_norm = math.sqrt(sum(value * value for value in right))
    if left_norm == 0 or right_norm == 0:
        # A zero vector has no directional evidence. Treating its similarity
        # as zero keeps the selection deterministic without inventing signal.
        return 0.0
    return sum(a * b for a, b in zip(left, right)) / (left_norm * right_norm)


def select_mmr(
    candidates: list[RetrievalCandidate],
    query_vector: list[float],
    *,
    lambda_mult: float,
) -> list[RetrievalCandidate]:
    """Return all candidates in deterministic MMR order.

    ``lambda_mult`` is the relevance weight: 1.0 is pure semantic relevance,
    0.0 is pure diversity. Candidates must arrive in raw semantic score order;
    the first item is retained as the semantic winner before diversification.
    """

    if not 0 <= lambda_mult <= 1:
        raise MMRSelectionError("MMR lambda must be between 0 and 1")
    candidate_vectors: list[list[float]] = []
    for candidate in candidates:
        if candidate.vector is None:
            raise MMRSelectionError(
                f"MMR candidate {candidate.chunk_id} is missing its vector"
            )
        candidate_vectors.append(candidate.vector)

    if len(candidates) < 2:
        if candidate_vectors:
            cosine_similarity(candidate_vectors[0], query_vector)
        return list(candidates)

    query_similarities = [
        cosine_similarity(vector, query_vector) for vector in candidate_vectors
    ]
    # `apply_regional_preference` preserves descending raw Qdrant score inside
    # each bucket. Retaining index zero makes the semantic winner an explicit
    # invariant instead of assuming the two score calculations are identical.
    first_index = 0
    selected_indices = [first_index]
    remaining = set(range(len(candidates))) - {first_index}

    while remaining:
        selected_index = max(
            remaining,
            key=lambda index: (
                lambda_mult * query_similarities[index]
                - (1 - lambda_mult)
                * max(
                    cosine_similarity(
                        candidate_vectors[index], candidate_vectors[other]
                    )
                    for other in selected_indices
                ),
                -index,
            ),
        )
        selected_indices.append(selected_index)
        remaining.remove(selected_index)

    return [candidates[index] for index in selected_indices]


def reorder_regional_candidates_with_mmr(
    candidates: list[RegionalCandidate],
    query_vectors_by_category: dict[str, list[float]],
    *,
    requested_market: str,
    lambda_mult: float,
) -> list[RegionalCandidate]:
    """Diversify candidates without changing regional/category precedence.

    Regional candidates are grouped by the same tier priority and category
    that the semantic path already established. Bucket order is retained, and
    MMR only reorders candidates inside each bucket. This is the guardrail that
    makes the later category-preserving ``deduplicate_and_cap`` behavior
    comparable between ``semantic`` and ``semantic_mmr``.
    """

    if not candidates:
        return []

    def tier_priority(tier: str) -> int:
        if requested_market == "egypt":
            return {"egypt": 0, "mena": 1, "global": 2}.get(tier, 2)
        if requested_market == "mena":
            return {"mena": 0, "global": 2}.get(tier, 2)
        return 0

    buckets: dict[tuple[int, str], list[RegionalCandidate]] = defaultdict(list)
    bucket_order: list[tuple[int, str]] = []
    for candidate in candidates:
        key = (tier_priority(candidate.market_tier), candidate.candidate.subquery_category)
        if key not in buckets:
            bucket_order.append(key)
        buckets[key].append(candidate)

    reordered: list[RegionalCandidate] = []
    for key in bucket_order:
        bucket = buckets[key]
        category = key[1]
        query_vector = query_vectors_by_category.get(category)
        if query_vector is None:
            raise MMRSelectionError(
                f"MMR query vector missing for category {category!r}"
            )
        reordered.extend(
            RegionalCandidate(
                candidate=selected,
                market_tier=bucket[0].market_tier,
                is_fallback=bucket[0].is_fallback,
                fallback_label=bucket[0].fallback_label,
            )
            for selected in select_mmr(
                [item.candidate for item in bucket],
                query_vector,
                lambda_mult=lambda_mult,
            )
        )

    return reordered
