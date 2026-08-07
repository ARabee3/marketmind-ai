"""Canonical checksums for immutable Strategy artifacts."""

from __future__ import annotations

import hashlib
import json
from typing import Any

from strategy_contracts import StrategyPlan


def canonical_json_checksum(value: Any) -> str:
    """Hash JSON using a stable representation independent of key ordering."""

    if hasattr(value, "model_dump"):
        value = value.model_dump(mode="json", exclude_none=True)
    encoded = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def strategy_plan_checksum(plan: StrategyPlan) -> str:
    """Return the checksum used by the Strategy decision binding."""

    return canonical_json_checksum(plan)
