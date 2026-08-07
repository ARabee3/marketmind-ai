"""Safe comparison of current-path and shadow orchestration evidence."""

from __future__ import annotations

from datetime import UTC, datetime

from .contracts import ShadowComparisonReportV1, ShadowPathSummaryV1


def compare_shadow_paths(
    current: ShadowPathSummaryV1,
    orchestrated: ShadowPathSummaryV1,
    *,
    generated_at: str | None = None,
) -> ShadowComparisonReportV1:
    """Compare only matching immutable scopes and preserve missing measurements."""

    if current.path != "current" or orchestrated.path != "orchestrated":
        raise ValueError("shadow comparison requires one current and one orchestrated path")
    if current.scope_key != orchestrated.scope_key:
        raise ValueError("shadow paths must use the same immutable scope key")

    notes: list[str] = []
    if current.publication_action_count or orchestrated.publication_action_count:
        quality = "regression"
        notes.append("publication action detected in a shadow path")
    elif current.valid is None or orchestrated.valid is None:
        quality = "unmeasured"
        notes.append("one or both paths did not produce a validity result")
    elif current.valid == orchestrated.valid:
        quality = "match"
    elif orchestrated.valid:
        quality = "improvement"
        notes.append("orchestrated path is valid where current path is not")
    else:
        quality = "regression"
        notes.append("orchestrated path lost validity relative to current path")

    return ShadowComparisonReportV1(
        contract_version="orchestration-shadow-report-v1",
        scope_key=current.scope_key,
        generated_at=generated_at
        or datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        quality=quality,
        current_valid=current.valid,
        orchestrated_valid=orchestrated.valid,
        latency_delta_ms=(
            orchestrated.latency_ms - current.latency_ms
            if current.latency_ms is not None and orchestrated.latency_ms is not None
            else None
        ),
        cost_delta_usd=(
            orchestrated.cost_usd - current.cost_usd
            if current.cost_usd is not None and orchestrated.cost_usd is not None
            else None
        ),
        citation_delta=(
            orchestrated.citation_count - current.citation_count
            if current.citation_count is not None
            and orchestrated.citation_count is not None
            else None
        ),
        current_publication_action_count=current.publication_action_count,
        orchestrated_publication_action_count=orchestrated.publication_action_count,
        notes=notes,
    )
