import json
import unittest
from copy import deepcopy
from pathlib import Path
from pydantic import ValidationError
from strategy_contracts import (
    StrategyBrief,
    StrategyPlan,
    RetrievedKnowledgePack,
    OwnerDecision,
    StrategyProgressEvent,
    BusinessProfilePayload,
    StrategyGenerateRequest,
    StrategyGenerateResponse,
    StrategyValidationResult,
    SubmitStrategyDecisionRequest,
    UpdateStrategyBriefRequest,
    validate_strategy_bundle,
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

    def test_generate_request_contains_complete_confirmed_profile(self):
        journey = self.load_fixture("cafe-full-journey.example.json")
        brief = StrategyBrief.model_validate(
            self.load_fixture("strategy-brief.example.json")
        )
        pack = RetrievedKnowledgePack.model_validate(
            self.load_fixture("strategy-retrieval-pack.example.json")
        )
        plan = StrategyPlan.model_validate(
            self.load_fixture("strategy-plan.example.json")
        )
        request = StrategyGenerateRequest.model_validate({
            "contract_version": "strategy-v1",
            "strategy_id": plan.strategy_id,
            "business_profile": journey["confirmed_business_profile"],
            "brief": brief.model_dump(mode="json"),
            "retrieved_knowledge_pack": pack.model_dump(mode="json"),
            "deterministic_channel_scores": [
                score.model_dump(mode="json") for score in plan.all_channel_scores
            ],
        })
        self.assertIn("confirmed_facts", request.business_profile.profile)

    def test_public_and_internal_endpoint_contracts(self):
        brief_data = self.load_fixture("strategy-brief.example.json")
        update_data = {
            key: value
            for key, value in brief_data.items()
            if key not in {"meta", "id", "strategy_id", "created_at", "updated_at"}
        }
        update = UpdateStrategyBriefRequest.model_validate(update_data)
        self.assertEqual(update.primary_objective, brief_data["primary_objective"])

        plan = StrategyPlan.model_validate(
            self.load_fixture("strategy-plan.example.json")
        )
        response = StrategyGenerateResponse(
            plan=plan,
            validation=StrategyValidationResult(valid=True, issues=[]),
        )
        self.assertTrue(response.validation.valid)

    # Decisions
    def test_decision_approved(self):
        data = self.load_fixture("strategy-decision-approved.example.json")
        decision = OwnerDecision.model_validate(data)
        self.assertEqual(decision.decision, "approved")

    def test_decision_rejected(self):
        data = self.load_fixture("strategy-decision-rejected.example.json")
        decision = OwnerDecision.model_validate(data)
        self.assertEqual(decision.decision, "rejected")

    def test_revision_request_requires_notes(self):
        with self.assertRaises(ValidationError):
            SubmitStrategyDecisionRequest.model_validate({
                "strategy_version": 1,
                "decision": "revision_requested",
                "revision_notes": "",
            })

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
        journey = self.load_fixture("cafe-full-journey.example.json")
        result = validate_strategy_bundle(
            business_profile=BusinessProfilePayload.model_validate(
                journey["confirmed_business_profile"]
            ),
            brief=StrategyBrief.model_validate(
                self.load_fixture("strategy-brief.example.json")
            ),
            retrieval_pack=RetrievedKnowledgePack.model_validate(
                self.load_fixture("strategy-retrieval-pack.example.json")
            ),
            deterministic_channel_scores=StrategyPlan.model_validate(
                self.load_fixture("strategy-plan.example.json")
            ).all_channel_scores,
            plan=StrategyPlan.model_validate(
                self.load_fixture("strategy-plan-stale-profile.invalid.json")
            ),
        )
        self.assertIn("STRATEGY_PROFILE_STALE", [issue.code for issue in result.issues])

    # Invalid Retrievals
    def test_invalid_expired_retrieval(self):
        data = self.load_fixture("strategy-retrieval-expired.invalid.json")
        with self.assertRaises(ValidationError):
            RetrievedKnowledgePack.model_validate(data)

    def test_invalid_failed_retrieval(self):
        data = self.load_fixture("strategy-retrieval-failed.invalid.json")
        with self.assertRaises(ValidationError):
            RetrievedKnowledgePack.model_validate(data)

    def test_parity_rejects_negative_budget(self):
        data = self.load_fixture("strategy-brief-english.example.json")
        data["external_budget_egp"] = -500
        with self.assertRaises(ValidationError):
            StrategyBrief.model_validate(data)

    def test_parity_rejects_retired_knowledge(self):
        data = self.load_fixture("strategy-retrieval-pack.example.json")
        data["items"][0]["source_quality"]["review_status"] = "retired"
        with self.assertRaises(ValidationError):
            RetrievedKnowledgePack.model_validate(data)

    def test_parity_rejects_impossible_channel_score(self):
        data = self.load_fixture("strategy-plan.example.json")
        data["all_channel_scores"][0]["scores"]["objective_fit"] = 9
        data["all_channel_scores"][0]["total_score"] = 999
        with self.assertRaises(ValidationError):
            StrategyPlan.model_validate(data)

    def test_parity_rejects_unknown_benchmark_citation(self):
        data = self.load_fixture("strategy-plan.example.json")
        data["kpi_targets"][0]["benchmark_citation_id"] = (
            "ffffffff-ffff-4fff-8fff-ffffffffffff"
        )
        with self.assertRaises(ValidationError):
            StrategyPlan.model_validate(data)

    def test_parity_rejects_duplicate_week_numbers(self):
        data = self.load_fixture("strategy-plan.example.json")
        first_week = deepcopy(data["content_strategy"]["weeks"][0])
        data["content_strategy"]["weeks"] = [deepcopy(first_week) for _ in range(12)]
        with self.assertRaises(ValidationError):
            StrategyPlan.model_validate(data)

    def test_parity_rejects_missing_base_budget_scenario(self):
        data = self.load_fixture("strategy-plan.example.json")
        data["budget_scenarios"] = [
            scenario
            for scenario in data["budget_scenarios"]
            if scenario["scenario_type"] != "base"
        ]
        with self.assertRaises(ValidationError):
            StrategyPlan.model_validate(data)

if __name__ == "__main__":
    unittest.main()
