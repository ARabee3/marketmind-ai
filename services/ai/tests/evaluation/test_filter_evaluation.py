from datetime import datetime

import pytest

from app.rag.schemas import RetrievalSubquery

from tests.evaluation.conftest import (
    all_fixture_data,
    expired_knowledge_fixture,
    knowledge_base_fixture,
    unapproved_knowledge_fixture,
    upsert_all_fixtures,
    upsert_fixture_points,
)
from tests.evaluation.runner.filter_runner import FilterEvalRunner
from tests.evaluation.runner.report import EvaluationReport, FilterEvalResult

pytestmark = pytest.mark.integration


async def _ensure_collection(qdrant_test_client, name: str, vector_size: int):
    from app.qdrant import create_collection, create_payload_indexes
    from app.qdrant.collection import collection_exists
    if not await collection_exists(qdrant_test_client, name):
        await create_collection(qdrant_test_client, name, vector_size=vector_size)
        await create_payload_indexes(qdrant_test_client, name)


@pytest.mark.eval_smoke
async def test_expired_points_filtered(
    qdrant_test_client,
    test_collection_name: str,
    fake_provider,
    expired_knowledge_fixture: list[dict],
    all_fixture_data: list[list[dict]],
) -> None:
    await _ensure_collection(qdrant_test_client, test_collection_name, fake_provider.config.dimensions)
    await upsert_all_fixtures(qdrant_test_client, test_collection_name, all_fixture_data, fake_provider)

    runner = FilterEvalRunner(qdrant_test_client, test_collection_name, fake_provider)
    now = datetime.utcnow()
    subquery = RetrievalSubquery(
        category="framework_diagnosis",
        text="Filter test for expired",
        kind_filter="framework",
        locale_filter=["ar-EG", "en", "mixed"],
        market_filter=["egypt", "mena", "global"],
    )
    for point in expired_knowledge_fixture:
        found = await runner.assert_chunk_not_returned(
            point["chunk_id"], "retail benchmark data", subquery, now
        )
        assert found is None, f"Expired point {point['chunk_id']} should not appear in search results"


@pytest.mark.eval_smoke
async def test_unapproved_points_filtered(
    qdrant_test_client,
    test_collection_name: str,
    fake_provider,
    unapproved_knowledge_fixture: list[dict],
    all_fixture_data: list[list[dict]],
) -> None:
    await _ensure_collection(qdrant_test_client, test_collection_name, fake_provider.config.dimensions)
    await upsert_all_fixtures(qdrant_test_client, test_collection_name, all_fixture_data, fake_provider)

    runner = FilterEvalRunner(qdrant_test_client, test_collection_name, fake_provider)
    now = datetime.utcnow()
    subquery = RetrievalSubquery(
        category="channel_instagram",
        text="Filter test for unapproved",
        kind_filter="channel_playbook",
        locale_filter=["ar-EG", "en", "mixed"],
        market_filter=["egypt", "mena", "global"],
    )
    for point in unapproved_knowledge_fixture:
        found = await runner.assert_chunk_not_returned(
            point["chunk_id"], "channel playbook", subquery, now
        )
        assert found is None, f"Unapproved point {point['chunk_id']} (status={point['review_status']}) should not appear in search results"


@pytest.mark.eval_smoke
async def test_future_effective_point_filtered(
    qdrant_test_client,
    test_collection_name: str,
    fake_provider,
    knowledge_base_fixture: list[dict],
) -> None:
    await _ensure_collection(qdrant_test_client, test_collection_name, fake_provider.config.dimensions)
    await upsert_fixture_points(qdrant_test_client, test_collection_name, knowledge_base_fixture, fake_provider)

    runner = FilterEvalRunner(qdrant_test_client, test_collection_name, fake_provider)
    now = datetime.utcnow()
    subquery = RetrievalSubquery(
        category="framework_diagnosis",
        text="Filter test for future",
        kind_filter="framework",
        locale_filter=["ar-EG", "en", "mixed"],
        market_filter=["egypt", "mena", "global"],
    )
    future_id = "a0000000-00f7-4000-8000-0000000000f7"
    found = await runner.assert_chunk_not_returned(
        future_id, "future marketing framework", subquery, now
    )
    assert found is None, f"Future-effective point {future_id} (effective_at=2030) should be filtered out"


@pytest.mark.eval_smoke
async def test_incompatible_locale_filtered(
    qdrant_test_client,
    test_collection_name: str,
    fake_provider,
    knowledge_base_fixture: list[dict],
) -> None:
    await _ensure_collection(qdrant_test_client, test_collection_name, fake_provider.config.dimensions)
    await upsert_fixture_points(qdrant_test_client, test_collection_name, knowledge_base_fixture, fake_provider)

    runner = FilterEvalRunner(qdrant_test_client, test_collection_name, fake_provider)
    now = datetime.utcnow()
    subquery = RetrievalSubquery(
        category="framework_diagnosis",
        text="Filter test for locale",
        kind_filter="framework",
        locale_filter=["ar-EG", "mixed"],
        market_filter=["egypt", "mena", "global"],
    )
    fr_id = "a0000000-00f1-4000-8000-0000000000f1"
    found = await runner.assert_chunk_not_returned(
        fr_id, "Marketing français", subquery, now
    )
    assert found is None, f"French-locale point {fr_id} should not appear in ar-EG search results"


@pytest.mark.eval_smoke
async def test_paid_media_filter_behaviour(
    qdrant_test_client,
    test_collection_name: str,
    fake_provider,
    knowledge_base_fixture: list[dict],
) -> None:
    await _ensure_collection(qdrant_test_client, test_collection_name, fake_provider.config.dimensions)
    await upsert_fixture_points(qdrant_test_client, test_collection_name, knowledge_base_fixture, fake_provider)

    runner = FilterEvalRunner(qdrant_test_client, test_collection_name, fake_provider)
    now = datetime.utcnow()

    budget_subquery = RetrievalSubquery(
        category="budget_method",
        text="Budget for paid media",
        kind_filter="budget_playbook",
        locale_filter=["ar-EG", "en", "mixed"],
        market_filter=["egypt", "mena", "global"],
        industry_filter=["retail"],
        paid_media_allowed=False,
    )
    found = await runner.assert_chunk_not_returned(
        "a0000000-0005-4000-8000-000000000005",
        "budget allocation strategies",
        budget_subquery,
        now,
    )
    assert found is None, "Budget playbook should be excluded when paid_media_allowed=false"


@pytest.mark.eval_full
async def test_hard_filter_cases_from_dataset(
    qdrant_test_client,
    test_collection_name: str,
    fake_provider,
    eval_dataset,
    all_fixture_data: list[list[dict]],
) -> None:
    await _ensure_collection(qdrant_test_client, test_collection_name, fake_provider.config.dimensions)
    await upsert_all_fixtures(qdrant_test_client, test_collection_name, all_fixture_data, fake_provider)

    runner = FilterEvalRunner(qdrant_test_client, test_collection_name, fake_provider)
    now = datetime.utcnow()
    report = EvaluationReport()

    for case in eval_dataset.cases:
        for hfc in case.hard_filter_cases:
            subquery = RetrievalSubquery(
                category="hard_filter_test",
                text=f"Hard filter check for {hfc.chunk_id}",
                kind_filter=["channel_playbook", "framework", "objective_playbook",
                             "budget_playbook", "measurement_playbook",
                             "regional_guidance", "sector_note"],
                locale_filter=["ar-EG", "en", "mixed"],
                market_filter=["egypt", "mena", "global"],
            )
            found = await runner.assert_chunk_not_returned(
                hfc.chunk_id, "generic search", subquery, now
            )
            was_filtered = found is None
            report.filter_results.append(
                FilterEvalResult(
                    case_id=case.id,
                    chunk_id=hfc.chunk_id,
                    filter_reason=hfc.filter_reason,
                    was_filtered=was_filtered,
                )
            )

    failures = [f for f in report.filter_results if not f.was_filtered]
    assert len(failures) == 0, f"Hard filter violations:\n" + "\n".join(
        f"  {f.case_id} chunk={f.chunk_id} reason={f.filter_reason}" for f in failures
    )
