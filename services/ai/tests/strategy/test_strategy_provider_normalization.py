from strategy_contracts import ChannelRole, StrategyPlan

from app.providers.strategy_provider import (
    _normalize_deterministic_budget_scenarios,
    _normalize_deterministic_channel_scores,
    _normalize_deterministic_kpi_targets,
)
from tests.strategy.fixtures import default_plan


def test_normalizes_deterministic_channel_scores_before_plan_validation() -> None:
    plan = default_plan()
    deterministic_scores = plan.all_channel_scores
    drifted = plan.model_dump(mode="json")
    drifted["all_channel_scores"] = [
        score
        for score in drifted["all_channel_scores"]
        if score["channel"] != drifted["selected_channels"][0]["channel"]
    ]

    normalized = _normalize_deterministic_channel_scores(
        drifted,
        deterministic_scores,
    )

    parsed = StrategyPlan.model_validate(normalized)
    assert [score.channel for score in parsed.all_channel_scores] == [
        score.channel for score in deterministic_scores
    ]
    assert parsed.selected_channels[0].channel in {
        score.channel for score in parsed.all_channel_scores
    }


def test_normalization_keeps_selected_channels_within_deterministic_limits() -> None:
    plan = default_plan()
    extra_primary = plan.all_channel_scores[0].model_copy(
        update={"channel": "extra_primary", "role": ChannelRole.primary},
    )
    deterministic_scores = [*plan.all_channel_scores, extra_primary]
    drifted = plan.model_dump(mode="json")
    drifted["selected_channels"].append(
        {
            **extra_primary.model_dump(mode="json"),
            "rationale": {
                "text": "The model selected an extra channel.",
                "source": "deterministic_result",
                "citation_ids": [],
            },
        },
    )

    normalized = _normalize_deterministic_channel_scores(
        drifted,
        deterministic_scores,
    )

    parsed = StrategyPlan.model_validate(normalized)
    assert sum(channel.role == ChannelRole.primary for channel in parsed.selected_channels) <= 2
    assert sum(channel.role == ChannelRole.supporting for channel in parsed.selected_channels) <= 1


def test_normalization_preserves_deterministic_kpi_targets() -> None:
    plan = default_plan()
    deterministic_targets = [
        target.model_copy(update={"target_value": "Week 4: +10%; Week 12: +30%"})
        for target in plan.kpi_targets
    ]
    drifted = plan.model_dump(mode="json")
    for target in drifted["kpi_targets"]:
        target["target_value"] = None

    normalized = _normalize_deterministic_kpi_targets(
        drifted,
        deterministic_targets,
    )

    parsed = StrategyPlan.model_validate(normalized)
    assert [target.target_value for target in parsed.kpi_targets] == [
        target.target_value for target in deterministic_targets
    ]


def test_normalization_removes_paid_scenarios_for_an_organic_only_brief() -> None:
    plan = default_plan()
    drifted = plan.model_dump(mode="json")
    drifted["budget_mode"] = "organic_only"

    normalized = _normalize_deterministic_budget_scenarios(
        drifted,
        deterministic_budget_scenarios=[],
        budget_mode="organic_only",
    )

    parsed = StrategyPlan.model_validate(normalized)
    assert parsed.budget_mode.value == "organic_only"
    assert parsed.budget_scenarios is None


def test_normalization_restores_deterministic_paid_scenarios() -> None:
    plan = default_plan()
    deterministic_scenarios = [
        scenario.model_dump(mode="json") for scenario in plan.budget_scenarios or []
    ]
    drifted = plan.model_dump(mode="json")
    drifted["budget_scenarios"] = []

    normalized = _normalize_deterministic_budget_scenarios(
        drifted,
        deterministic_budget_scenarios=deterministic_scenarios,
        budget_mode="monthly_amount",
    )

    parsed = StrategyPlan.model_validate(normalized)
    assert [scenario.scenario_type for scenario in parsed.budget_scenarios or []] == [
        scenario.scenario_type for scenario in plan.budget_scenarios or []
    ]


def test_stripped_v2_schema_converts_one_of_unions_for_gemini() -> None:
    from strategy_contracts import StrategyPlanV2

    from app.providers.strategy_provider import _strip_additional_properties

    schema = _strip_additional_properties(StrategyPlanV2.model_json_schema())

    assert "oneOf" not in schema
    assert schema["properties"]["content_handoff"]["anyOf"]

    from google.genai import types

    types.Schema.model_validate(schema)


async def test_gemini_v2_provider_round_trips_without_undefined_normalizer(
    monkeypatch,
) -> None:
    """The Gemini v2 path must normalize without undefined helpers (regression).

    ``_normalize_deterministic_channel_scores_v2`` never existed; the v2 path
    must rebuild commitments and the content handoff deterministically and
    validate as a StrategyPlanV2 without extra model-provided fields.
    """
    import json
    from types import SimpleNamespace

    from strategy_contracts import StrategyPlanV2

    from app.providers.strategy_provider import (
        GeminiStrategyProvider,
        _normalize_v2_commitments_and_handoff,
    )
    from app.strategy.assembler import PromptAssembly
    from tests.strategy.fixtures import default_brief_v2, default_plan_v2

    brief = default_brief_v2()
    plan_dict = default_plan_v2().model_dump(mode="json")
    plan_dict.pop("channel_commitments")
    plan_dict.pop("content_handoff")

    class FakeModels:
        def generate_content(self, **_kwargs):
            return SimpleNamespace(text=json.dumps(plan_dict))

    fake_types = SimpleNamespace()
    fake_genai = SimpleNamespace(
        types=fake_types,
        Client=lambda **kwargs: SimpleNamespace(models=FakeModels()),
    )

    monkeypatch.setattr("google.genai", fake_genai)

    prompt = PromptAssembly(
        system_prompt="system",
        user_prompt="user",
        metadata={
            "channel_choices": [
                choice.model_dump(mode="json") for choice in brief.channel_choices
            ]
        },
    )
    provider = GeminiStrategyProvider(api_key="test", model="gemini-test", timeout_ms=5_000)

    plan = await provider.generate_strategy_plan(
        prompt, output_model=StrategyPlanV2
    )

    assert isinstance(plan, StrategyPlanV2)
    assert plan.channel_commitments
    assert plan.content_handoff

    normalized = _normalize_v2_commitments_and_handoff(
        plan.model_dump(mode="json"), prompt
    )
    assert normalized["channel_commitments"][0]["channel"] == "facebook"
