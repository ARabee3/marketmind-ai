"""Safe Content generation event metadata helpers."""

from __future__ import annotations

from typing import Any

from content_contracts import ContentValidationResult


def content_event_metadata(
    assembly_metadata: dict[str, Any],
    *,
    attempt: int | None = None,
    item_count: int | None = None,
    plan_count: int | None = None,
    validation: ContentValidationResult | None = None,
) -> dict[str, Any]:
    """Build reproducible, non-secret event metadata from PromptAssembly data."""
    metadata = dict(assembly_metadata)
    if attempt is not None:
        metadata["attempt"] = attempt
    if item_count is not None:
        metadata["item_count"] = item_count
    if plan_count is not None:
        metadata["plan_count"] = plan_count
    if validation is not None:
        metadata["validation_valid"] = validation.valid
        metadata["validation_issue_codes"] = [
            issue.code for issue in validation.issues
        ]
    return metadata
