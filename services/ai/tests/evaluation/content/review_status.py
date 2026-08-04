"""Phase 7 reviewer sign-off tracker.

Surfaces which eval cases still need which reviewer slot, and gives aggregate
pending counts.  A case is ``final`` only when all four reviewers have signed off.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from tests.evaluation.content.runner.runner import load_all_cases
from tests.evaluation.content.schema import ContentEvalCase, ReviewerSignOff


@dataclass
class ReviewerPendingReport:
    """Pending reviewer status for a single case."""

    case_id: str
    sector: str
    final: bool
    pending_roles: list[str]
    signed_roles: list[str]

    def to_dict(self) -> dict[str, Any]:
        return {
            "case_id": self.case_id,
            "sector": self.sector,
            "final": self.final,
            "pending_roles": self.pending_roles,
            "signed_roles": self.signed_roles,
        }


@dataclass
class ReviewStatusReport:
    """Aggregate and per-case reviewer sign-off status."""

    generated_at: str
    total_cases: int
    final_cases: int
    pending_cases: int
    pending_by_role: dict[str, int]
    per_case: list[ReviewerPendingReport]

    def to_dict(self) -> dict[str, Any]:
        return {
            "generated_at": self.generated_at,
            "total_cases": self.total_cases,
            "final_cases": self.final_cases,
            "pending_cases": self.pending_cases,
            "pending_by_role": self.pending_by_role,
            "per_case": [c.to_dict() for c in self.per_case],
        }

    def to_json(self, indent: int = 2) -> str:
        return json.dumps(self.to_dict(), ensure_ascii=False, indent=indent)


def _reviewer_slots(case: ContentEvalCase) -> list[tuple[str, ReviewerSignOff]]:
    """Return the four reviewer slots as (role_key, signoff) pairs."""
    reviewers = case.reviewers
    return [
        ("owner_mokhtar", reviewers.owner_mokhtar),
        ("eval_mostafa", reviewers.eval_mostafa),
        ("ai_product_merzk", reviewers.ai_product_merzk),
        ("safety_rabee", reviewers.safety_rabee),
    ]


def _case_report(case: ContentEvalCase) -> ReviewerPendingReport:
    """Build the pending reviewer report for one case."""
    pending: list[str] = []
    signed: list[str] = []
    for role_key, signoff in _reviewer_slots(case):
        if signoff.signed_off:
            signed.append(role_key)
        else:
            pending.append(role_key)
    return ReviewerPendingReport(
        case_id=case.case_id,
        sector=case.sector,
        final=len(pending) == 0,
        pending_roles=pending,
        signed_roles=signed,
    )


def build_review_status_report(
    cases: list[ContentEvalCase] | None = None,
) -> ReviewStatusReport:
    """Build a report of reviewer sign-off status across all cases."""
    if cases is None:
        cases = load_all_cases()

    per_case = [_case_report(case) for case in cases]
    total = len(per_case)
    final = sum(1 for c in per_case if c.final)
    pending = total - final

    pending_by_role: dict[str, int] = {
        "owner_mokhtar": 0,
        "eval_mostafa": 0,
        "ai_product_merzk": 0,
        "safety_rabee": 0,
    }
    for report in per_case:
        for role in report.pending_roles:
            pending_by_role[role] += 1

    return ReviewStatusReport(
        generated_at=datetime.now(timezone.utc).isoformat(),
        total_cases=total,
        final_cases=final,
        pending_cases=pending,
        pending_by_role=pending_by_role,
        per_case=per_case,
    )


def format_review_status_summary(report: ReviewStatusReport) -> str:
    """Human-readable summary of the review status report."""
    lines = [
        f"Review Status Report ({report.generated_at})",
        f"Total cases: {report.total_cases}",
        f"Final cases: {report.final_cases}",
        f"Pending cases: {report.pending_cases}",
        "",
        "Pending by role:",
    ]
    for role, count in report.pending_by_role.items():
        lines.append(f"  {role}: {count}")
    lines.append("")
    lines.append("Pending cases:")
    pending = [c for c in report.per_case if not c.final]
    if not pending:
        lines.append("  None")
    else:
        for c in pending:
            lines.append(f"  {c.case_id}: {', '.join(c.pending_roles)}")
    return "\n".join(lines)


if __name__ == "__main__":
    import sys
    from pathlib import Path

    _repo_root = Path(__file__).resolve().parents[6]
    _contracts_path = _repo_root / "packages" / "contracts" / "python"
    if str(_contracts_path) not in sys.path:
        sys.path.insert(0, str(_contracts_path))

    print(format_review_status_summary(build_review_status_report()))
