"""Relevance-labelled retrieval metrics.

These helpers deliberately refuse to manufacture negatives or a complete
relevant set. A case is measured only when its labels support the metric; the
caller can report the reason when it is not yet measured.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

RelevanceLabel = Literal["relevant", "not_relevant"]


@dataclass(frozen=True)
class LabeledMetricResult:
    precision_at_5: float | None
    recall_at_5: float | None
    mrr_at_5: float | None
    unmeasured_reasons: dict[str, str] = field(default_factory=dict)


def measure_labeled_metrics(
    ranked_chunk_ids: list[str],
    relevance_labels: dict[str, RelevanceLabel],
    known_relevant_chunk_ids: list[str],
    relevance_labels_complete: bool,
    *,
    k: int = 5,
) -> LabeledMetricResult:
    """Measure precision/recall/MRR at ``k`` without inferred labels.

    Precision and MRR require a label for every returned candidate in the
    measured top-k. Recall additionally requires an explicitly complete set of
    known relevant IDs. Missing evidence leaves only that metric ``None`` and
    records a reason rather than reporting a false zero or pass.
    """

    if k < 1:
        raise ValueError("metric cutoff k must be positive")

    top_k = ranked_chunk_ids[:k]
    reasons: dict[str, str] = {}
    missing_labels = sorted({chunk_id for chunk_id in top_k if chunk_id not in relevance_labels})

    precision_at_5: float | None = None
    mrr_at_5: float | None = None
    if not top_k:
        reasons["precision_at_5"] = "no_returned_candidates"
        reasons["mrr_at_5"] = "no_returned_candidates"
    elif missing_labels:
        reasons["precision_at_5"] = "missing_candidate_labels"
        reasons["mrr_at_5"] = "missing_candidate_labels"
    else:
        relevant_flags = [relevance_labels[chunk_id] == "relevant" for chunk_id in top_k]
        precision_at_5 = sum(relevant_flags) / len(relevant_flags)
        first_relevant = next(
            (index for index, is_relevant in enumerate(relevant_flags, start=1) if is_relevant),
            None,
        )
        mrr_at_5 = 1 / first_relevant if first_relevant is not None else 0.0

    known_relevant = list(dict.fromkeys(known_relevant_chunk_ids))
    labeled_relevant = {
        chunk_id
        for chunk_id, label in relevance_labels.items()
        if label == "relevant"
    }
    if not relevance_labels_complete:
        reasons["recall_at_5"] = "complete_relevant_set_not_declared"
    elif not known_relevant:
        reasons["recall_at_5"] = "complete_relevant_set_missing"
    elif labeled_relevant != set(known_relevant):
        reasons["recall_at_5"] = "complete_relevant_set_inconsistent"
    elif any(
        relevance_labels.get(chunk_id) != "relevant" for chunk_id in known_relevant
    ):
        reasons["recall_at_5"] = "known_relevant_labels_incomplete"
    else:
        returned_relevant = set(top_k).intersection(known_relevant)
        recall_at_5 = len(returned_relevant) / len(known_relevant)
        return LabeledMetricResult(
            precision_at_5=precision_at_5,
            recall_at_5=recall_at_5,
            mrr_at_5=mrr_at_5,
            unmeasured_reasons=reasons,
        )

    return LabeledMetricResult(
        precision_at_5=precision_at_5,
        recall_at_5=None,
        mrr_at_5=mrr_at_5,
        unmeasured_reasons=reasons,
    )
