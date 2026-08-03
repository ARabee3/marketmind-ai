"""Tests for Strategy prompt assembly."""

from __future__ import annotations

import json

import pytest

from app.strategy.assembler import (
    DecisionBundle,
    PromptAssembly,
    assemble_generation_prompt,
    assemble_revision_prompt,
)
from app.strategy.prompt_versions import (
    STRATEGY_GENERATE_PROMPT_VERSION,
    STRATEGY_REFERENCE_PATTERN_VERSION,
    STRATEGY_REVISE_PROMPT_VERSION,
)
from tests.strategy.fixtures import (
    default_brief,
    default_plan,
    english_brief,
    make_decision_bundle,
    make_generate_request,
    make_revise_request,
    mixed_brief,
)

PROVIDER_NAME = "mock"
MODEL_NAME = "mock-strategy-model"


class TestPromptAssembly:
    def test_assemble_generation_prompt_returns_expected_shape(self):
        request = make_generate_request()
        bundle = make_decision_bundle()

        assembly = assemble_generation_prompt(request, bundle, PROVIDER_NAME, MODEL_NAME)

        assert isinstance(assembly, PromptAssembly)
        assert assembly.system_prompt
        assert assembly.user_prompt
        assert isinstance(assembly.metadata, dict)

    def test_generation_metadata_is_complete(self):
        request = make_generate_request()
        bundle = make_decision_bundle()

        assembly = assemble_generation_prompt(request, bundle, PROVIDER_NAME, MODEL_NAME)
        meta = assembly.metadata

        assert meta["prompt_version"] == STRATEGY_GENERATE_PROMPT_VERSION
        assert meta["provider_name"] == PROVIDER_NAME
        assert meta["model"] == MODEL_NAME
        assert meta["contract_version"] == "strategy-v1"
        assert meta["reference_pattern_version"] == STRATEGY_REFERENCE_PATTERN_VERSION
        assert meta["strategy_id"] == request.strategy_id
        assert meta["brief_id"] == request.brief.id
        assert meta["retrieval_run_id"] == request.retrieved_knowledge_pack.retrieval_run_id
        assert meta["profile_version_id"] == request.business_profile.id
        assert meta["profile_version"] == request.business_profile.version
        assert meta["profile_confirmed_at"] == request.business_profile.confirmed_at.isoformat()
        assert meta["channel_score_rule_version"] == "strategy-channel-score-v1"
        assert meta["language_mode"] == request.brief.plan_language
        assert meta["budget_mode"] == request.brief.external_budget_mode
        assert meta["paid_media_allowed"] == request.brief.paid_media_allowed
        assert "assembled_at" in meta

    def test_generation_system_prompt_contains_key_rules(self):
        request = make_generate_request()
        bundle = make_decision_bundle()

        assembly = assemble_generation_prompt(request, bundle, PROVIDER_NAME, MODEL_NAME)
        system = assembly.system_prompt

        assert STRATEGY_GENERATE_PROMPT_VERSION in system
        assert STRATEGY_REFERENCE_PATTERN_VERSION in system
        assert "at most 2 primary + 1 supporting" in system or "2 primary" in system
        assert "confirmed_profile_fact" in system
        assert "retrieved_reviewed_guidance" in system
        assert "verified_benchmark" in system
        assert "assumption" in system
        assert "Do not invent" in system
        assert "Do not generate final captions" in system
        assert "Do not describe publishing" in system
        assert "section planning skeleton" in system.lower()
        assert "Owner-facing output language" in system
        assert "ar-EG" in system
        assert "brief.plan_language" in system

    def test_revision_system_prompt_contains_language_directive(self):
        request = make_revise_request()
        bundle = make_decision_bundle()

        assembly = assemble_revision_prompt(request, bundle, PROVIDER_NAME, MODEL_NAME)
        system = assembly.system_prompt

        assert "Owner-facing output language" in system
        assert "ar-EG" in system

    def test_generation_user_context_contains_provenance_sections(self):
        request = make_generate_request()
        bundle = make_decision_bundle()

        assembly = assemble_generation_prompt(request, bundle, PROVIDER_NAME, MODEL_NAME)
        user = assembly.user_prompt

        # The prompt must contain each provenance section so the model can ground claims.
        assert request.business_profile.id in user
        assert request.brief.id in user
        assert request.retrieved_knowledge_pack.retrieval_run_id in user
        assert request.retrieved_knowledge_pack.items[0].chunk_id in user
        assert "deterministic_decisions" in user
        assert "channel_scores" in user
        assert "output_contract" in user

    def test_generation_user_context_is_valid_json(self):
        request = make_generate_request()
        bundle = make_decision_bundle()

        assembly = assemble_generation_prompt(request, bundle, PROVIDER_NAME, MODEL_NAME)
        # The user prompt is a short intro followed by JSON. Extract the JSON block.
        json_text = assembly.user_prompt.split("\n\n", 1)[1]
        parsed = json.loads(json_text)

        assert parsed["turn_instruction"]
        assert "business_profile" in parsed["provenance"]
        assert "strategy_brief" in parsed["provenance"]
        assert "retrieved_knowledge_pack" in parsed["provenance"]
        assert "deterministic_decisions" in parsed["provenance"]
        assert parsed["output_contract"]["contract_version"] == "strategy-v1"

    def test_generation_user_context_includes_strategy_quality_requirements(self):
        request = make_generate_request()
        bundle = make_decision_bundle()

        assembly = assemble_generation_prompt(request, bundle, PROVIDER_NAME, MODEL_NAME)
        parsed = json.loads(assembly.user_prompt.split("\n\n", 1)[1])
        requirements = parsed["output_contract"]["strategy_quality_requirements"]

        assert requirements["platform_specific_format_mix"] is True
        assert requirements["competitive_response_without_margin_destroying_discount"] is True
        assert requirements["loyalty_or_retention_mechanic_before_week_4"] is True
        assert requirements["delivery_channel_has_activation_or_blocker_when_relevant"] is True

    def test_assemble_revision_prompt_returns_expected_shape(self):
        request = make_revise_request()
        bundle = make_decision_bundle()

        assembly = assemble_revision_prompt(request, bundle, PROVIDER_NAME, MODEL_NAME)

        assert isinstance(assembly, PromptAssembly)
        assert assembly.system_prompt
        assert assembly.user_prompt
        assert isinstance(assembly.metadata, dict)

    def test_revision_metadata_records_prior_version_and_notes(self):
        request = make_revise_request()
        bundle = make_decision_bundle()

        assembly = assemble_revision_prompt(request, bundle, PROVIDER_NAME, MODEL_NAME)
        meta = assembly.metadata

        assert meta["prompt_version"] == STRATEGY_REVISE_PROMPT_VERSION
        assert meta["revision_notes"] == request.revision_notes
        assert meta["previous_plan_version"] == request.previous_plan.version

    def test_revision_user_context_contains_previous_plan_and_notes(self):
        request = make_revise_request()
        bundle = make_decision_bundle()

        assembly = assemble_revision_prompt(request, bundle, PROVIDER_NAME, MODEL_NAME)
        user = assembly.user_prompt

        assert request.previous_plan.id in user
        assert request.revision_notes in user
        assert "previous_plan" in user
        assert "owner_revision_notes" in user

    def test_revision_user_context_includes_strategy_quality_requirements(self):
        request = make_revise_request()
        bundle = make_decision_bundle()

        assembly = assemble_revision_prompt(request, bundle, PROVIDER_NAME, MODEL_NAME)
        parsed = json.loads(assembly.user_prompt.split("\n\n", 1)[1])
        requirements = parsed["output_contract"]["strategy_quality_requirements"]

        assert requirements["platform_specific_format_mix"] is True
        assert requirements["weekly_cadence_names_platforms_and_frequency"] is True

    def test_revision_system_prompt_forbids_mutating_prior_plan(self):
        request = make_revise_request()
        bundle = make_decision_bundle()

        assembly = assemble_revision_prompt(request, bundle, PROVIDER_NAME, MODEL_NAME)
        system = assembly.system_prompt

        assert STRATEGY_REVISE_PROMPT_VERSION in system
        assert "produce a new plan version" in system
        assert "mutate the previous plan" in system.lower()

    def test_mismatched_profile_and_brief_raises(self):
        request = make_generate_request()
        request.brief.business_profile_version.business_profile_version_id = "11111111-1111-4111-8111-111111111111"
        bundle = make_decision_bundle()

        with pytest.raises(ValueError, match="different business profile version"):
            assemble_generation_prompt(request, bundle, PROVIDER_NAME, MODEL_NAME)

    def test_mismatched_retrieval_pack_raises(self):
        request = make_generate_request()
        request.retrieved_knowledge_pack.profile_version_id = "22222222-2222-4222-8222-222222222222"
        bundle = make_decision_bundle()

        with pytest.raises(ValueError, match="different business profile"):
            assemble_generation_prompt(request, bundle, PROVIDER_NAME, MODEL_NAME)

    @pytest.mark.parametrize("brief_fixture,expected_language", [
        (default_brief, "ar-EG"),
        (english_brief, "en"),
        (mixed_brief, "mixed"),
    ])
    def test_language_mode_is_preserved(self, brief_fixture, expected_language):
        request = make_generate_request(brief=brief_fixture())
        bundle = make_decision_bundle()

        assembly = assemble_generation_prompt(request, bundle, PROVIDER_NAME, MODEL_NAME)

        assert assembly.metadata["language_mode"] == expected_language
        assert assembly.user_prompt.count(expected_language) >= 1 or expected_language in assembly.user_prompt

    def test_decision_bundle_without_optional_fields_serializes(self):
        request = make_generate_request()
        bundle = DecisionBundle(channel_scores=default_plan().all_channel_scores)

        assembly = assemble_generation_prompt(request, bundle, PROVIDER_NAME, MODEL_NAME)
        user = json.loads(assembly.user_prompt.split("\n\n", 1)[1])

        assert user["provenance"]["deterministic_decisions"]["budget_scenarios"] == []
        assert user["provenance"]["deterministic_decisions"]["kpi_targets"] == []
