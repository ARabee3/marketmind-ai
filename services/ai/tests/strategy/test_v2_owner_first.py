"""Owner-first strategy-v2 tests: endpoint, projection, and validation."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).parent.parent.parent.parent.parent / "packages" / "contracts" / "python"))

from strategy_contracts import (
    StrategyPlanV2,
    StrategyV2Channel,
    validate_strategy_v2_bundle,
)
from app.core.config import Settings, get_settings
from app.main import app
from app.providers.strategy_provider import MockStrategyProvider
from app.strategy.content_handoff import (
    map_strategy_label_to_content_format,
    normalize_strategy_label,
    project_content_handoff,
)
from app.strategy.validators import StrategyV2ValidationPipeline
from tests.strategy.fixtures import (
    make_generate_request_v2,
    make_revise_request_v2,
)


def _mock_settings():
    settings = Settings()
    settings.ai_provider_mode = "mock"
    return settings


@pytest.fixture()
def client():
    app.dependency_overrides[get_settings] = _mock_settings
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


class TestContentHandoffProjection:
    def test_normalize_labels(self):
        assert normalize_strategy_label("  Reels ") == "reels"
        assert normalize_strategy_label("Static Image") == "static_image"

    def test_mapping(self):
        assert map_strategy_label_to_content_format("reels") == "short_video_script"
        assert map_strategy_label_to_content_format("photo") == "static_image_post"
        assert map_strategy_label_to_content_format("carousel") == "carousel_brief"
        assert map_strategy_label_to_content_format("poll") == "text_post"
        assert map_strategy_label_to_content_format("short_video_script") == "short_video_script"
        assert map_strategy_label_to_content_format("unknown_label") is None

    def test_project_unavailable_when_no_content_channel(self):
        weeks = [
            {"week_number": n, "formats": ["photo"]} for n in range(1, 13)
        ]
        handoff = project_content_handoff(
            calendar_weeks=weeks,
            selected_channels=["website", "delivery_platforms"],
            language="ar-EG",
        )
        assert handoff.available is False
        assert handoff.reason == "no_content_supported_channels"

    def test_project_unavailable_when_week_has_unknown_formats(self):
        weeks = [{"week_number": n, "formats": ["photo"]} for n in range(1, 13)]
        weeks[3] = {"week_number": 4, "formats": ["mystery"]}
        handoff = project_content_handoff(
            calendar_weeks=weeks,
            selected_channels=["facebook", "instagram"],
            language="ar-EG",
        )
        assert handoff.available is False
        assert handoff.reason == "incomplete_weekly_formats"

    def test_project_available_with_content_channels(self):
        weeks = [
            {"week_number": n, "formats": ["reels", "photo"]} for n in range(1, 13)
        ]
        handoff = project_content_handoff(
            calendar_weeks=weeks,
            selected_channels=["facebook", "google_business_profile"],
            language="ar-EG",
        )
        assert handoff.available is True
        assert handoff.channels == ["facebook", "google_business_profile"]
        assert len(handoff.weeks) == 12
        assert handoff.weeks[0].formats == ["short_video_script", "static_image_post"]


class TestV2GenerateEndpoint:
    def test_generate_returns_valid_v2_plan(self, client):
        request = make_generate_request_v2()
        response = client.post(
            "/internal/v1/ai/strategy/generate",
            json=request.model_dump(mode="json"),
        )
        assert response.status_code == 200
        data = response.json()
        plan = StrategyPlanV2.model_validate(data["plan"])
        assert plan.contract_version == "strategy-v2"
        assert data["validation"]["valid"]
        assert data["validation"]["issues"] == []
        # Commitments match the owner's choices exactly.
        chosen = [c.channel.value for c in request.brief.channel_choices]
        assert [c.channel for c in plan.channel_commitments] == chosen
        # The content handoff is the deterministic projection of the plan.
        assert plan.content_handoff.available is True
        assert plan.content_handoff.channels == [
            "facebook", "instagram", "google_business_profile",
        ]
        assert len(plan.calendar_weeks) == 12
        assert len(plan.owner_advice.weeks) == 12

    def test_generate_returns_unavailable_handoff_for_manual_only(self, client):
        from strategy_contracts import (
            ChannelRole,
            ChannelSetupState,
            StrategyChannelChoice,
            StrategyV2Channel,
        )

        request = make_generate_request_v2()
        brief = request.brief.model_copy(
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
        request = make_generate_request_v2(brief=brief)
        response = client.post(
            "/internal/v1/ai/strategy/generate",
            json=request.model_dump(mode="json"),
        )
        assert response.status_code == 200
        plan = StrategyPlanV2.model_validate(response.json()["plan"])
        assert plan.content_handoff.available is False
        assert plan.content_handoff.reason == "no_content_supported_channels"
        assert [c.channel for c in plan.channel_commitments] == [
            StrategyV2Channel.website,
            StrategyV2Channel.delivery_platforms,
        ]

    def test_revise_returns_v2_plan(self, client):
        request = make_revise_request_v2()
        response = client.post(
            "/internal/v1/ai/strategy/revise",
            json=request.model_dump(mode="json"),
        )
        assert response.status_code == 200
        data = response.json()
        assert data["validation"]["valid"]
        plan = StrategyPlanV2.model_validate(data["plan"])
        assert plan.version == 2
        assert plan.contract_version == "strategy-v2"

    def test_v2_plan_fails_closed_on_channel_commitment_drift(self):
        """The deterministic normalization must never let a model add channels."""
        from app.strategy.assembler import DecisionBundle
        from app.api.internal_v1.strategy import (
            _generate_validated_plan,
            _normalize_v2_plan,
        )
        from app.strategy.assembler import assemble_generation_v2_prompt
        from app.strategy.validators import validate_v2_plan_against_request

        request = make_generate_request_v2()
        prompt = assemble_generation_v2_prompt(
            request=request,
            decision_bundle=DecisionBundle(
                channel_scores=[], budget_scenarios=None, kpi_targets=None
            ),
            provider_name="mock",
            model="mock",
        )
        # Simulate a model that drifted: the raw plan gained an extra channel
        # and confused the strategy-v2 contract label with plan version 2.
        provider = MockStrategyProvider()

        raw = provider.fixture_plan_v2.model_dump(mode="json")
        raw["strategy_id"] = "d0000000-0000-4000-8000-000000000009"
        raw["version"] = 2
        raw["brief_id"] = "d0000000-0000-4000-8000-000000000010"
        raw["profile_version"] = {
            "business_profile_version_id": "d0000000-0000-4000-8000-000000000011",
            "confirmed_at": "2026-01-01T00:00:00Z",
            "version": 99,
        }
        raw["retrieval_run_id"] = "d0000000-0000-4000-8000-000000000012"
        raw["channel_commitments"].append(
            {
                "channel": "tiktok",
                "role": "supporting",
                "setup_state": "setup_later",
                "capability_state": "owner_managed",
                "rationale": {
                    "text": "إضافة غير مرغوبة",
                    "source": "owner_input",
                    "citation_ids": [],
                },
            }
        )
        drifted_plan = StrategyPlanV2.model_validate(raw)
        # The endpoint normalization repairs commitments from the brief choices.
        repaired = _normalize_v2_plan(drifted_plan, request)
        assert [c.channel for c in repaired.channel_commitments] == [
            c.channel for c in request.brief.channel_choices
        ]
        assert repaired.strategy_id == request.strategy_id
        assert repaired.version == 1
        assert repaired.brief_id == request.brief.id
        assert (
            repaired.profile_version.business_profile_version_id
            == request.business_profile.id
        )
        assert (
            repaired.retrieval_run_id
            == request.retrieved_knowledge_pack.retrieval_run_id
        )
        result = validate_strategy_v2_bundle(
            business_profile=request.business_profile,
            brief=request.brief,
            retrieval_pack=request.retrieved_knowledge_pack,
            plan=repaired,
        )
        assert result.valid

    def test_policy_violation_is_retried_with_planning_only_repair_prompt(
        self, client, monkeypatch
    ):
        from app.providers.strategy_provider import MockStrategyProvider

        request = make_generate_request_v2()

        class SequenceProvider(MockStrategyProvider):
            def __init__(self):
                super().__init__()
                self.call_count = 0
                self.prompts = []

            async def generate_strategy_plan(self, prompt, output_model=None):
                self.call_count += 1
                self.prompts.append(prompt)
                plan = await super().generate_strategy_plan(
                    prompt, output_model=output_model
                )
                if self.call_count != 1:
                    return plan

                commitments = list(plan.channel_commitments)
                commitments[1] = commitments[1].model_copy(
                    update={
                        "rationale": commitments[1].rationale.model_copy(
                            update={
                                "text": "Ads have been launched for this channel."
                            }
                        )
                    }
                )
                return plan.model_copy(update={"channel_commitments": commitments})

        provider = SequenceProvider()
        monkeypatch.setattr(
            "app.api.internal_v1.strategy.create_strategy_provider",
            lambda _settings: provider,
        )

        response = client.post(
            "/internal/v1/ai/strategy/generate",
            json=request.model_dump(mode="json"),
        )

        assert response.status_code == 200
        assert provider.call_count == 2
        assert "planning-only" in provider.prompts[1].system_prompt
        assert "channel_commitments[*].rationale" in provider.prompts[1].system_prompt

    def test_v2_validation_pipeline_rejects_plan_language_mismatch(self):
        from strategy_contracts import StrategyPlanV2 as PlanV2
        from tests.strategy.fixtures import default_plan_v2

        request = make_generate_request_v2()
        bad_plan = default_plan_v2().model_copy()
        bad_plan.goal = bad_plan.goal.model_copy(
            update={"text": "This goal is written entirely in English."}
        )
        pipeline = StrategyV2ValidationPipeline()
        result = pipeline.validate(bad_plan, request)
        assert result.valid is False
        assert any(
            issue.code == "STRATEGY_LANGUAGE_MISMATCH" for issue in result.issues
        )
