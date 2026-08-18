import json
from strategy_contracts import (
    ChannelCapabilityState,
    ChannelCommitment,
    ChannelRole,
    ChannelSetupState,
    ClaimSource,
    ContentHandoffAvailable,
    ContentHandoffUnavailable,
    ContentHandoffWeek,
    SourcedClaim,
    StrategyBriefV2,
    StrategyChannelChoice,
    StrategyPlanV2,
    StrategyV2Channel,
    validate_strategy_v2_bundle,
)
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
    DecisionType,
    ChannelRole,
)

EXAMPLES_DIR = Path(__file__).parent.parent / "examples"


def _load_bundle_fixtures():
    journey = json.loads(
        (EXAMPLES_DIR / "cafe-full-journey.example.json").read_text(encoding="utf-8")
    )
    brief = StrategyBrief.model_validate(
        json.loads(
            (EXAMPLES_DIR / "strategy-brief.example.json").read_text(encoding="utf-8")
        )
    )
    pack = RetrievedKnowledgePack.model_validate(
        json.loads(
            (EXAMPLES_DIR / "strategy-retrieval-pack.example.json").read_text(
                encoding="utf-8"
            )
        )
    )
    plan = StrategyPlan.model_validate(
        json.loads(
            (EXAMPLES_DIR / "strategy-plan.example.json").read_text(encoding="utf-8")
        )
    )
    profile = BusinessProfilePayload.model_validate(journey["confirmed_business_profile"])
    return profile, brief, pack, plan


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

    def test_validate_strategy_bundle_valid_fixture(self):
        profile, brief, pack, plan = _load_bundle_fixtures()
        result = validate_strategy_bundle(
            business_profile=profile,
            brief=brief,
            retrieval_pack=pack,
            deterministic_channel_scores=plan.all_channel_scores,
            plan=plan,
        )
        self.assertTrue(result.valid)
        self.assertEqual(result.issues, [])

    def _expect_validation_code(self, code: str, **overrides):
        profile, brief, pack, plan = _load_bundle_fixtures()
        result = validate_strategy_bundle(
            business_profile=overrides.get("profile", profile),
            brief=overrides.get("brief", brief),
            retrieval_pack=overrides.get("pack", pack),
            deterministic_channel_scores=overrides.get(
                "deterministic_scores", plan.all_channel_scores
            ),
            plan=overrides.get("plan", plan),
            decision=overrides.get("decision"),
        )
        codes = [issue.code for issue in result.issues]
        self.assertIn(code, codes, msg=f"expected {code}, got {codes}")

    def test_validate_evidence_not_approved(self):
        _, _, pack, plan = _load_bundle_fixtures()
        retired_items = [
            item.model_copy(
                update={
                    "source_quality": item.source_quality.model_copy(
                        update={"review_status": "retired"}
                    )
                }
            )
            for item in pack.items
        ]
        retired_pack = pack.model_copy(update={"items": retired_items})
        self._expect_validation_code(
            "STRATEGY_EVIDENCE_NOT_APPROVED",
            pack=retired_pack,
        )

    def test_validate_invalid_benchmark(self):
        _, _, _, plan = _load_bundle_fixtures()
        bad_targets = [
            target.model_copy(
                update={"benchmark_citation_id": "ffffffff-ffff-4fff-8fff-ffffffffffff"}
            )
            for target in plan.kpi_targets
        ]
        bad_plan = plan.model_copy(update={"kpi_targets": bad_targets})
        self._expect_validation_code(
            "STRATEGY_INVALID_BENCHMARK",
            plan=bad_plan,
        )

    def test_validate_score_mismatch_total(self):
        _, _, _, plan = _load_bundle_fixtures()
        bad_scores = plan.all_channel_scores[0].scores.model_copy(
            update={"objective_fit": 0.1}
        )
        bad_all_scores = [
            score.model_copy(update={"scores": bad_scores}) if i == 0 else score
            for i, score in enumerate(plan.all_channel_scores)
        ]
        bad_plan = plan.model_copy(
            update={
                "all_channel_scores": bad_all_scores,
                "selected_channels": bad_all_scores,
            }
        )
        self._expect_validation_code(
            "STRATEGY_SCORE_MISMATCH",
            plan=bad_plan,
        )

    def test_validate_score_mismatch_deterministic_input(self):
        _, _, _, plan = _load_bundle_fixtures()
        changed = deepcopy(plan.all_channel_scores)
        changed[0].excluded_reason = "Changed after scoring"
        self._expect_validation_code(
            "STRATEGY_SCORE_MISMATCH",
            deterministic_scores=changed,
        )

    def test_validate_budget_mismatch_missing_base(self):
        _, _, _, plan = _load_bundle_fixtures()
        bad_scenarios = [
            scenario
            for scenario in plan.budget_scenarios
            if scenario.scenario_type != "base"
        ]
        bad_plan = plan.model_copy(update={"budget_scenarios": bad_scenarios})
        self._expect_validation_code(
            "STRATEGY_BUDGET_MISMATCH",
            plan=bad_plan,
        )

    def test_validate_duplicate_weeks(self):
        _, _, _, plan = _load_bundle_fixtures()
        duplicated_weeks = [
            plan.content_strategy.weeks[0].model_copy() for _ in range(12)
        ]
        bad_roadmap = plan.content_strategy.model_copy(
            update={"weeks": duplicated_weeks}
        )
        bad_plan = plan.model_copy(update={"content_strategy": bad_roadmap})
        self._expect_validation_code(
            "STRATEGY_RULE_VIOLATION",
            plan=bad_plan,
        )

    def test_validate_content_agent_leakage(self):
        _, _, _, plan = _load_bundle_fixtures()
        bad_plan = plan.model_copy(
            update={
                "executive_summary": plan.executive_summary.model_copy(
                    update={"text": "Caption: اطلب الكشري الآن مع #KosharyCorner"}
                )
            }
        )
        self._expect_validation_code(
            "STRATEGY_RULE_VIOLATION",
            plan=bad_plan,
        )

    def test_validate_paid_tactics_when_paid_media_disallowed(self):
        _, brief, _, plan = _load_bundle_fixtures()
        unpaid_brief = brief.model_copy(
            update={
                "paid_media_allowed": False,
                "external_budget_mode": "scenario_only",
                "external_budget_egp": None,
            }
        )
        bad_plan = plan.model_copy(
            update={
                "executive_summary": plan.executive_summary.model_copy(
                    update={"text": "Run boosted posts and launch paid ads this week."}
                )
            }
        )
        self._expect_validation_code(
            "STRATEGY_RULE_VIOLATION",
            brief=unpaid_brief,
            plan=bad_plan,
        )

    def test_validate_profile_unconfirmed(self):
        profile, brief, pack, plan = _load_bundle_fixtures()
        unconfirmed = profile.model_copy(update={"confirmed_at": None})
        result = validate_strategy_bundle(
            business_profile=unconfirmed,
            brief=brief,
            retrieval_pack=pack,
            deterministic_channel_scores=plan.all_channel_scores,
            plan=plan,
        )
        self.assertIn(
            "STRATEGY_PROFILE_UNCONFIRMED",
            [issue.code for issue in result.issues],
        )

    def test_validate_channel_limit_exceeded(self):
        _, _, _, plan = _load_bundle_fixtures()
        extra_channel = plan.all_channel_scores[2].model_copy(
            update={"channel": "whatsapp", "role": ChannelRole.primary}
        )
        bad_selected = list(plan.selected_channels) + [extra_channel]
        bad_plan = plan.model_copy(update={"selected_channels": bad_selected})
        self._expect_validation_code(
            "STRATEGY_CHANNEL_LIMIT_EXCEEDED",
            plan=bad_plan,
        )

    def test_validate_arithmetic_failure(self):
        _, _, _, plan = _load_bundle_fixtures()
        base_scenario = plan.budget_scenarios[1]
        bad_allocations = [
            allocation.model_copy(update={"amount_egp": 100.0}) if i == 0 else allocation
            for i, allocation in enumerate(base_scenario.channel_allocations)
        ]
        bad_scenarios = [
            scenario.model_copy(update={"channel_allocations": bad_allocations})
            if i == 1
            else scenario
            for i, scenario in enumerate(plan.budget_scenarios)
        ]
        bad_plan = plan.model_copy(update={"budget_scenarios": bad_scenarios})
        self._expect_validation_code(
            "STRATEGY_ARITHMETIC_FAILURE",
            plan=bad_plan,
        )

    def test_validate_revision_requires_notes(self):
        profile, brief, pack, plan = _load_bundle_fixtures()
        decision = OwnerDecision.model_construct(
            id="00000000-0000-4000-8000-000000000099",
            strategy_id=plan.strategy_id,
            strategy_version=plan.version,
            decision=DecisionType.revision_requested,
            revision_notes="   ",
            decided_by_user_id="00000000-0000-4000-8000-000000000098",
            decided_at=plan.created_at,
        )
        self._expect_validation_code(
            "STRATEGY_RULE_VIOLATION",
            decision=decision,
        )

    def test_validate_approval_blocked(self):
        profile, brief, pack, plan = _load_bundle_fixtures()
        decision = OwnerDecision.model_validate(
            self.load_fixture("strategy-decision-approved.example.json")
        )
        decision = decision.model_copy(update={"strategy_version": plan.version + 1})
        self._expect_validation_code("STRATEGY_RULE_VIOLATION", decision=decision)
        self._expect_validation_code("STRATEGY_APPROVAL_BLOCKED", decision=decision)


if __name__ == "__main__":
    unittest.main()


class TestStrategyV2Contracts(unittest.TestCase):
    """Owner-first strategy-v2 contract tests (issue #135)."""

    EXAMPLES_DIR = EXAMPLES_DIR

    def load_v2_bundle(self):
        journey = json.loads(
            (self.EXAMPLES_DIR / "cafe-full-journey.example.json").read_text(encoding="utf-8")
        )
        brief = StrategyBriefV2.model_validate(
            json.loads(
                (self.EXAMPLES_DIR / "strategy-brief-v2.example.json").read_text(encoding="utf-8")
            )
        )
        plan = StrategyPlanV2.model_validate(
            json.loads(
                (self.EXAMPLES_DIR / "strategy-plan-v2.example.json").read_text(encoding="utf-8")
            )
        )
        pack = RetrievedKnowledgePack.model_validate(
            json.loads(
                (self.EXAMPLES_DIR / "strategy-retrieval-pack.example.json").read_text(encoding="utf-8")
            )
        )
        profile = BusinessProfilePayload.model_validate(journey["confirmed_business_profile"])
        profile = profile.model_copy(
            update={
                "id": brief.business_profile_version.business_profile_version_id,
                "version": brief.business_profile_version.version,
                "confirmed_at": brief.business_profile_version.confirmed_at,
            }
        )
        return profile, brief, plan, pack

    def test_valid_v2_bundle(self):
        profile, brief, plan, pack = self.load_v2_bundle()
        result = validate_strategy_v2_bundle(
            business_profile=profile, brief=brief, retrieval_pack=pack, plan=plan
        )
        self.assertTrue(result.valid, f"issues: {[i.model_dump() for i in result.issues]}")
        self.assertEqual(result.issues, [])

    def test_v2_execution_language_rejects_explicit_publish_claim(self):
        profile, brief, plan, pack = self.load_v2_bundle()
        bad = plan.model_copy(update={
            "evidence_summary": plan.evidence_summary.model_copy(
                update={"text": "تم نشر الإعلان أمس وحقق نتائج جيدة."}
            )
        })

        result = validate_strategy_v2_bundle(
            business_profile=profile, brief=brief, retrieval_pack=pack, plan=bad
        )

        self.assertTrue(
            any(
                issue.code == "STRATEGY_RULE_VIOLATION"
                and issue.field == "evidence_summary"
                for issue in result.issues
            )
        )

    def test_v2_execution_language_allows_safe_planning_reference(self):
        profile, brief, plan, pack = self.load_v2_bundle()
        safe_text = "تعتمد الخطة على بيانات الملف لتقييم الإعلان المقترح."
        safe = plan.model_copy(update={
            "evidence_summary": plan.evidence_summary.model_copy(
                update={"text": safe_text}
            )
        })

        result = validate_strategy_v2_bundle(
            business_profile=profile, brief=brief, retrieval_pack=pack, plan=safe
        )

        self.assertFalse(
            any(
                issue.code == "STRATEGY_RULE_VIOLATION"
                and "publishing" in issue.message
                for issue in result.issues
            )
        )

    def test_brief_v2_rejects_missing_primary(self):
        profile, brief, plan, pack = self.load_v2_bundle()
        bad = brief.model_copy(
            update={
                "channel_choices": [
                    choice.model_copy(update={"role": "supporting"})
                    for choice in brief.channel_choices
                ]
            }
        )
        result = validate_strategy_v2_bundle(
            business_profile=profile, brief=bad, retrieval_pack=pack, plan=plan
        )
        self.assertFalse(result.valid)
        codes = {issue.code for issue in result.issues}
        self.assertIn("STRATEGY_CHANNEL_CHOICE_MISMATCH", codes)

    def test_plan_v2_rejects_extra_channel_commitment(self):
        profile, brief, plan, pack = self.load_v2_bundle()
        bad = plan.model_copy(
            update={
                "channel_commitments": plan.channel_commitments
                + [
                    ChannelCommitment(
                        channel=StrategyV2Channel.tiktok,
                        role=ChannelRole.supporting,
                        setup_state=ChannelSetupState.setup_later,
                        capability_state=ChannelCapabilityState.owner_managed,
                        rationale=SourcedClaim(
                            text="لم يختر المالك تيك توك",
                            source=ClaimSource.owner_input,
                            citation_ids=[],
                        ),
                    )
                ]
            }
        )
        result = validate_strategy_v2_bundle(
            business_profile=profile, brief=brief, retrieval_pack=pack, plan=bad
        )
        self.assertFalse(result.valid)
        self.assertIn(
            "STRATEGY_CHANNEL_CHOICE_MISMATCH", {issue.code for issue in result.issues}
        )

    def test_plan_v2_rejects_incomplete_handoff_week(self):
        profile, brief, plan, pack = self.load_v2_bundle()
        bad = plan.model_copy()
        handoff = bad.content_handoff
        self.assertTrue(handoff.available)
        bad = bad.model_copy(
            update={
                "content_handoff": ContentHandoffAvailable(
                    available=True,
                    channels=handoff.channels,
                    language=handoff.language,
                    weeks=[ContentHandoffWeek(week_number=1, formats=[])]
                    + handoff.weeks[1:],
                )
            }
        )
        result = validate_strategy_v2_bundle(
            business_profile=profile, brief=brief, retrieval_pack=pack, plan=bad
        )
        self.assertFalse(result.valid)
        self.assertIn(
            "STRATEGY_CONTENT_HANDOFF_INVALID",
            {issue.code for issue in result.issues},
        )

    def test_owner_managed_plan_without_handoff_is_valid(self):
        profile, brief, plan, pack = self.load_v2_bundle()
        brief = brief.model_copy(
            update={
                "channel_choices": [
                    StrategyChannelChoice(
                        channel=StrategyV2Channel.website,
                        role=ChannelRole.primary,
                        setup_state=ChannelSetupState.existing_link,
                        public_url="https://kosharycorner.com",
                    ),
                    StrategyChannelChoice(
                        channel=StrategyV2Channel.delivery_platforms,
                        role=ChannelRole.supporting,
                        setup_state=ChannelSetupState.setup_later,
                    ),
                ]
            }
        )
        plan = plan.model_copy(
            update={
                "channel_commitments": [
                    ChannelCommitment(
                        channel=StrategyV2Channel.website,
                        role=ChannelRole.primary,
                        setup_state=ChannelSetupState.existing_link,
                        capability_state=ChannelCapabilityState.owner_managed,
                        rationale=SourcedClaim(
                            text="الموقع يديره المالك مباشرة",
                            source=ClaimSource.owner_input,
                            citation_ids=[],
                        ),
                    ),
                    ChannelCommitment(
                        channel=StrategyV2Channel.delivery_platforms,
                        role=ChannelRole.supporting,
                        setup_state=ChannelSetupState.setup_later,
                        capability_state=ChannelCapabilityState.owner_managed,
                        rationale=SourcedClaim(
                            text="منصات التوصيل تديرها المنصات نفسها",
                            source=ClaimSource.owner_input,
                            citation_ids=[],
                        ),
                    ),
                ],
                "content_handoff": ContentHandoffUnavailable(
                    available=False,
                    reason="no_content_supported_channels",
                    message="No owner-selected channel maps to content-v1.",
                ),
            }
        )
        result = validate_strategy_v2_bundle(
            business_profile=profile, brief=brief, retrieval_pack=pack, plan=plan
        )
        self.assertTrue(result.valid, f"issues: {[i.model_dump() for i in result.issues]}")

    def test_handoff_channel_must_be_owner_selected(self):
        profile, brief, plan, pack = self.load_v2_bundle()
        bad = plan.model_copy()
        handoff = bad.content_handoff
        bad = bad.model_copy(
            update={
                "content_handoff": ContentHandoffAvailable(
                    available=True,
                    channels=["tiktok"],
                    language=handoff.language,
                    weeks=handoff.weeks,
                )
            }
        )
        result = validate_strategy_v2_bundle(
            business_profile=profile, brief=brief, retrieval_pack=pack, plan=bad
        )
        self.assertFalse(result.valid)
        self.assertIn(
            "STRATEGY_CONTENT_HANDOFF_INVALID",
            {issue.code for issue in result.issues},
        )

    def test_connected_choice_requires_target_for_publishing_ready(self):
        profile, brief, plan, pack = self.load_v2_bundle()
        bad = plan.model_copy()
        bad = bad.model_copy(
            update={
                "channel_commitments": [
                    commitment.model_copy(
                        update={"capability_state": ChannelCapabilityState.publishing_ready}
                    )
                    if commitment.channel == StrategyV2Channel.facebook
                    else commitment
                    for commitment in bad.channel_commitments
                ]
            }
        )
        result = validate_strategy_v2_bundle(
            business_profile=profile, brief=brief, retrieval_pack=pack, plan=bad
        )
        self.assertFalse(result.valid)
        self.assertIn(
            "STRATEGY_CHANNEL_CHOICE_MISMATCH",
            {issue.code for issue in result.issues},
        )


if __name__ == "__main__":
    unittest.main()
