from strategy_contracts import ChannelRole, StrategyPlan

from app.providers.strategy_provider import _normalize_deterministic_channel_scores
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
