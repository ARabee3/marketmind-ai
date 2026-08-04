"""Shared deterministic validator result types."""

from __future__ import annotations

from typing import Any


class CheckResult:
    """One named deterministic check result."""

    def __init__(self, name: str, passed: bool, reason: str | None = None) -> None:
        self.name = name
        self.passed = passed
        self.reason = reason

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "passed": self.passed,
            "reason": self.reason,
        }


class CaseValidationResult:
    """All deterministic check results for one eval case."""

    def __init__(
        self,
        case_id: str,
        checked: bool,
        checks: list[CheckResult],
        error: str | None = None,
    ) -> None:
        self.case_id = case_id
        self.checked = checked
        self.checks = checks
        self.error = error

    @property
    def passed(self) -> bool:
        if self.error:
            return False
        return all(check.passed for check in self.checks)

    @property
    def failed_checks(self) -> list[CheckResult]:
        return [check for check in self.checks if not check.passed]

    def to_dict(self) -> dict[str, Any]:
        return {
            "case_id": self.case_id,
            "checked": self.checked,
            "passed": self.passed,
            "error": self.error,
            "checks": [check.to_dict() for check in self.checks],
        }
