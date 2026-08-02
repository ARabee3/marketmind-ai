from uuid import UUID

from app.rag.schemas import RegionalCandidate


def deduplicate_and_cap(
    candidates: list[RegionalCandidate],
    max_per_entry: int = 2,
    max_total: int = 8,
) -> list[RegionalCandidate]:
    """Deduplicate candidates and apply deterministic limits.

    Ensures that we don't overwhelm the LLM with too many chunks from the same
    source entry, and caps the overall total.

    Assumes candidates are ALREADY sorted by priority (regional, then score).
    """
    entry_counts: dict[UUID, int] = {}
    selected = []
    seen_chunks: set[UUID] = set()
    covered_categories: set[str] = set()

    for rc in candidates:
        if len(selected) >= max_total:
            break

        category = rc.candidate.subquery_category
        if category in covered_categories:
            continue

        chunk_id = rc.candidate.chunk_id
        if chunk_id in seen_chunks:
            continue

        entry_id = rc.candidate.entry_id
        if entry_counts.get(entry_id, 0) >= max_per_entry:
            continue

        selected.append(rc)
        seen_chunks.add(chunk_id)
        entry_counts[entry_id] = entry_counts.get(entry_id, 0) + 1
        covered_categories.add(category)

    for rc in candidates:
        if len(selected) >= max_total:
            break

        chunk_id = rc.candidate.chunk_id
        if chunk_id in seen_chunks:
            continue

        entry_id = rc.candidate.entry_id
        if entry_counts.get(entry_id, 0) >= max_per_entry:
            continue

        selected.append(rc)
        seen_chunks.add(chunk_id)
        entry_counts[entry_id] = entry_counts.get(entry_id, 0) + 1

    return selected
