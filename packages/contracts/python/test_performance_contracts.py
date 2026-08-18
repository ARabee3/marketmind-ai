import json
import math
import unittest
from pathlib import Path
from pydantic import ValidationError

from performance_contracts import (
    MetricSnapshotV1,
    OptimizationProposalV1,
    PerformanceOverviewV1,
    PerformanceSyncWindowV1,
)


EXAMPLES_DIR = Path(__file__).parent.parent / "examples"


def load(name: str):
    return json.loads((EXAMPLES_DIR / name).read_text(encoding="utf-8"))


class TestPerformanceContracts(unittest.TestCase):
    def test_snapshot_preserves_zero_and_unavailable(self):
        snapshot = MetricSnapshotV1.model_validate(load("performance-snapshot.example.json"))
        self.assertEqual(snapshot.metrics.post_media_view.status, "available")
        self.assertEqual(snapshot.metrics.post_media_view.value, 0)
        self.assertEqual(snapshot.metrics.post_clicks.value, 14)
        self.assertEqual(
            snapshot.metrics.post_total_media_view_unique.reason,
            "not_returned",
        )

    def test_sync_window(self):
        window = PerformanceSyncWindowV1.model_validate(
            load("performance-sync-window.example.json")
        )
        self.assertEqual(window.window, "24h")
        self.assertEqual(window.state, "queued")

    def test_overview(self):
        overview = PerformanceOverviewV1.model_validate(
            load("performance-overview.example.json")
        )
        self.assertEqual(overview.baseline.status, "not_ready")
        self.assertEqual(overview.baseline.reason, "insufficient_snapshots")

    def test_optimization_proposal_is_strict_and_pending(self):
        proposal = OptimizationProposalV1.model_validate(
            load("optimization-proposal.example.json")
        )
        self.assertEqual(proposal.status, "PENDING_OWNER_DECISION")
        self.assertEqual(proposal.change_kind, "hook_style")
        self.assertEqual(len(proposal.basis_snapshot_ids), 3)

    def test_optimization_proposal_rejects_unsupported_causal_claims(self):
        value = load("optimization-proposal.example.json")
        value["rationale"] = (
            "This proves the hook causes higher clicks and will increase sales."
        )
        with self.assertRaises(ValidationError):
            OptimizationProposalV1.model_validate(value)

    def test_optimization_proposal_allows_explicit_uncertainty_disclaimers(self):
        value = load("optimization-proposal.example.json")
        value["uncertainty"] = (
            "This is not statistically significant and does not guarantee results."
        )
        OptimizationProposalV1.model_validate(value)

    def test_optimization_proposal_rejects_arabic_scope_directives(self):
        value = load("optimization-proposal.example.json")
        value["instruction"] = "نوصي بتغيير الموضوع في المنشور القادم."
        with self.assertRaises(ValidationError):
            OptimizationProposalV1.model_validate(value)

    def test_invalid_fixtures_are_rejected(self):
        invalid = [
            "performance-snapshot-negative-value.invalid.json",
            "performance-snapshot-coerced-value.invalid.json",
            "performance-snapshot-sensitive-metadata.invalid.json",
            "performance-sync-window-unknown-state.invalid.json",
            "optimization-proposal-unsupported-kind.invalid.json",
        ]
        for name in invalid:
            with self.subTest(name=name):
                with self.assertRaises(ValidationError):
                    if "snapshot" in name:
                        MetricSnapshotV1.model_validate(load(name))
                    elif "optimization" in name:
                        OptimizationProposalV1.model_validate(load(name))
                    else:
                        PerformanceSyncWindowV1.model_validate(load(name))

    def test_non_finite_metric_values_are_rejected(self):
        snapshot = load("performance-snapshot.example.json")
        snapshot["metrics"]["post_media_view"]["value"] = math.inf
        with self.assertRaises(ValidationError):
            MetricSnapshotV1.model_validate(snapshot)


if __name__ == "__main__":
    unittest.main()
