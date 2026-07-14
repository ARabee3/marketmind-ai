import os
import json
import unittest
from pathlib import Path
from pydantic import ValidationError
from strategy_contracts import (
    StrategyBrief,
    StrategyPlan,
    RetrievedKnowledgePack,
    OwnerDecision,
    StrategyProgressEvent
)

EXAMPLES_DIR = Path(__file__).parent.parent / "examples"

class TestStrategyContracts(unittest.TestCase):
    def load_fixture(self, filename: str):
        path = EXAMPLES_DIR / filename
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)

    # Valid Briefs
    def test_strategy_brief_arabic(self):
        data = self.load_fixture("strategy-brief.example.json")
        brief = StrategyBrief.model_validate(data)
        self.assertEqual(str(brief.id), "b0000000-0000-4000-8000-000000000001")

    def test_strategy_brief_english(self):
        data = self.load_fixture("strategy-brief-english.example.json")
        brief = StrategyBrief.model_validate(data)
        self.assertEqual(str(brief.id), "b2000000-0000-4000-8000-000000000002")

    def test_strategy_brief_mixed(self):
        data = self.load_fixture("strategy-brief-mixed.example.json")
        brief = StrategyBrief.model_validate(data)
        self.assertEqual(str(brief.id), "b3000000-0000-4000-8000-000000000003")

    # Valid Retrieval Pack
    def test_retrieval_pack(self):
        data = self.load_fixture("strategy-retrieval-pack.example.json")
        pack = RetrievedKnowledgePack.model_validate(data)
        self.assertEqual(str(pack.retrieval_run_id), "c0000000-0000-4000-8000-000000000001")

    # Valid Plans
    def test_strategy_plan(self):
        data = self.load_fixture("strategy-plan.example.json")
        plan = StrategyPlan.model_validate(data)
        self.assertEqual(str(plan.id), "d0000000-0000-4000-8000-000000000001")

    def test_strategy_plan_organic(self):
        data = self.load_fixture("strategy-plan-organic.example.json")
        plan = StrategyPlan.model_validate(data)
        self.assertEqual(str(plan.id), "d0000000-0000-4000-8000-000000000002")

    # Decisions
    def test_decision_approved(self):
        data = self.load_fixture("strategy-decision-approved.example.json")
        decision = OwnerDecision.model_validate(data)
        self.assertEqual(decision.decision, "approved")

    def test_decision_rejected(self):
        data = self.load_fixture("strategy-decision-rejected.example.json")
        decision = OwnerDecision.model_validate(data)
        self.assertEqual(decision.decision, "rejected")

    # Version History
    def test_version_history(self):
        data = self.load_fixture("strategy-version-history.example.json")
        for entry in data:
            if "meta" in entry:
                continue
            self.assertIn("strategy_id", entry)
            self.assertIn("version", entry)

    # Progress Transcript
    def test_progress_transcript(self):
        data = self.load_fixture("strategy-progress.transcript.json")
        for entry in data:
            if "meta" in entry:
                continue
            event = StrategyProgressEvent.model_validate(entry)
            self.assertEqual(event.type, "strategy_progress")

    # Invalid Briefs
    def test_invalid_missing_budget(self):
        data = self.load_fixture("strategy-brief-missing-budget.invalid.json")
        with self.assertRaises(ValidationError):
            StrategyBrief.model_validate(data)

    def test_invalid_paid_disallowed(self):
        data = self.load_fixture("strategy-brief-paid-disallowed.invalid.json")
        with self.assertRaises(ValidationError):
            StrategyBrief.model_validate(data)

    # Invalid Plans
    def test_invalid_too_many_channels(self):
        data = self.load_fixture("strategy-plan-too-many-channels.invalid.json")
        with self.assertRaises(ValidationError):
            StrategyPlan.model_validate(data)

    def test_invalid_citation(self):
        data = self.load_fixture("strategy-plan-invalid-citation.invalid.json")
        with self.assertRaises(ValidationError):
            StrategyPlan.model_validate(data)

    def test_invalid_benchmark(self):
        data = self.load_fixture("strategy-plan-invalid-benchmark.invalid.json")
        with self.assertRaises(ValidationError):
            StrategyPlan.model_validate(data)

    def test_invalid_stale_profile(self):
        data = self.load_fixture("strategy-plan-stale-profile.invalid.json")
        # Staleness is checked dynamically by the application since Pydantic does not have the brief to cross-compare.
        # But let's check that it parses as a basic model first.
        plan = StrategyPlan.model_validate(data)
        self.assertEqual(plan.profile_version.version, 2)

    # Invalid Retrievals
    def test_invalid_expired_retrieval(self):
        data = self.load_fixture("strategy-retrieval-expired.invalid.json")
        with self.assertRaises(ValidationError):
            RetrievedKnowledgePack.model_validate(data)

    def test_invalid_failed_retrieval(self):
        data = self.load_fixture("strategy-retrieval-failed.invalid.json")
        with self.assertRaises(ValidationError):
            RetrievedKnowledgePack.model_validate(data)

if __name__ == "__main__":
    unittest.main()
