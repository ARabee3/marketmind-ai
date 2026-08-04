"""Tests for KPI target mode selection."""

from __future__ import annotations

from strategy_contracts import KpiTargetMode

from app.decisions.kpi_modes import (
    compute_kpi_targets,
    select_kpi_target_mode,
)
from tests.decisions.fixtures.base import (
    default_brief,
    default_retrieval_pack,
    hydrated_item,
)


def test_verified_benchmark_range_selected():
    brief = default_brief()
    pack = default_retrieval_pack()
    item = hydrated_item(
        channel="instagram",
        kind="benchmark_report",
        metric=["engagement_rate"],
        evidence_tier="verified_benchmark",
    )
    pack = pack.model_copy(update={"items": list(pack.items) + [item]})
    target = select_kpi_target_mode(
        metric="engagement_rate",
        funnel_stage="awareness",
        brief=brief,
        retrieval_pack=pack,
        channel="instagram",
    )
    assert target.target_mode == KpiTargetMode.verified_benchmark_range
    assert target.target_value is not None
    benchmark_chunk_ids = {
        str(benchmark.chunk_id)
        for benchmark in pack.items
        if benchmark.evidence_tier == "verified_benchmark"
    }
    assert target.benchmark_citation_id in benchmark_chunk_ids
    assert target.notes.citation_ids == [target.benchmark_citation_id]


def test_owner_target_selected():
    brief = default_brief()
    brief = brief.model_copy(
        update={"constraints": list(brief.constraints) + ["target 500 new followers"]}
    )
    pack = default_retrieval_pack()
    target = select_kpi_target_mode(
        metric="new_followers",
        funnel_stage="acquisition",
        brief=brief,
        retrieval_pack=pack,
    )
    assert target.target_mode == KpiTargetMode.owner_target
    assert target.target_value is not None


def test_establish_baseline_fallback():
    brief = default_brief()
    pack = default_retrieval_pack()
    target = select_kpi_target_mode(
        metric="reach",
        funnel_stage="awareness",
        brief=brief,
        retrieval_pack=pack,
    )
    assert target.target_mode == KpiTargetMode.establish_baseline


def test_conversion_baseline_fallback_has_phased_numeric_target():
    brief = default_brief()
    pack = default_retrieval_pack()
    target = select_kpi_target_mode(
        metric="orders",
        funnel_stage="conversion",
        brief=brief,
        retrieval_pack=pack,
    )

    assert target.target_mode == KpiTargetMode.establish_baseline
    assert target.target_value is not None
    assert any(character.isdigit() for character in target.target_value)


def test_compute_kpi_targets_for_objective():
    brief = default_brief()
    pack = default_retrieval_pack()
    targets = compute_kpi_targets(
        brief=brief,
        retrieval_pack=pack,
        primary_channels=["instagram", "google_maps"],
    )
    assert len(targets) >= 1
    assert all(isinstance(t.target_mode.value, str) for t in targets)


def test_kpi_targets_are_deterministic():
    brief = default_brief()
    pack = default_retrieval_pack()
    targets_a = compute_kpi_targets(
        brief=brief,
        retrieval_pack=pack,
        primary_channels=["instagram"],
    )
    targets_b = compute_kpi_targets(
        brief=brief,
        retrieval_pack=pack,
        primary_channels=["instagram"],
    )
    assert [t.model_dump(mode="json") for t in targets_a] == [
        t.model_dump(mode="json") for t in targets_b
    ]
