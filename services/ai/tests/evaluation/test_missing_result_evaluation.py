from datetime import datetime

import pytest

from app.embeddings import EmbedRequest
from app.qdrant import collection_exists, create_collection, create_payload_indexes, search_points
from app.rag.filter_builder import build_category_filter
from app.rag.query_builder import build_subqueries
from app.rag.schemas import RetrievalQueryContext

from tests.evaluation.conftest import (
    all_fixture_data,
    knowledge_base_fixture,
    upsert_all_fixtures,
    upsert_fixture_points,
)

pytestmark = pytest.mark.integration


@pytest.mark.eval_smoke
async def test_retention_retail_has_no_direct_match(
    qdrant_test_client,
    test_collection_name: str,
    fake_provider,
    all_fixture_data: list[list[dict]],
) -> None:
    if not await collection_exists(qdrant_test_client, test_collection_name):
        await create_collection(qdrant_test_client, test_collection_name, vector_size=3072)
        await create_payload_indexes(qdrant_test_client, test_collection_name)

    await upsert_all_fixtures(qdrant_test_client, test_collection_name, all_fixture_data, fake_provider)

    ctx = RetrievalQueryContext(
        business_type="retail",
        market="egypt",
        locale="ar-EG",
        objective="retention",
        funnel_stage="retention",
        active_channels=["facebook"],
        asset_capability=[],
        team_capacity="المالك فقط",
        budget_mode="scenario_only",
        industry="retail",
    )
    subqueries = build_subqueries(ctx)
    now = datetime.utcnow()
    objective_subquery = next(sq for sq in subqueries if sq.category == "objective_funnel")
    q_filter = build_category_filter(objective_subquery, now)
    vector = (await fake_provider.embed(EmbedRequest(texts=[objective_subquery.text]))).embeddings[0].vector
    results = await search_points(
        qdrant_test_client,
        test_collection_name,
        vector=vector,
        query_filter=q_filter,
        limit=5,
    )
    assert len(results) == 0, f"Expected no direct match for retail retention, got {len(results)} results"


@pytest.mark.eval_full
async def test_empty_retrieval_has_gaps(
    qdrant_test_client,
    test_collection_name: str,
    fake_provider,
    all_fixture_data: list[list[dict]],
) -> None:
    if not await collection_exists(qdrant_test_client, test_collection_name):
        await create_collection(qdrant_test_client, test_collection_name, vector_size=3072)
        await create_payload_indexes(qdrant_test_client, test_collection_name)

    await upsert_all_fixtures(qdrant_test_client, test_collection_name, all_fixture_data, fake_provider)

    ctx = RetrievalQueryContext(
        business_type="retail",
        market="egypt",
        locale="ar-EG",
        objective="retention",
        funnel_stage="retention",
        active_channels=[],
        asset_capability=[],
        team_capacity="المالك فقط",
        budget_mode="organic_only",
        industry="retail",
    )
    subqueries = build_subqueries(ctx)
    now = datetime.utcnow()
    gap_categories_found = set()
    for sq in subqueries:
        q_filter = build_category_filter(sq, now)
        vector = (await fake_provider.embed(EmbedRequest(texts=[sq.text]))).embeddings[0].vector
        results = await search_points(
            qdrant_test_client,
            test_collection_name,
            vector=vector,
            query_filter=q_filter,
            limit=5,
        )
        if len(results) == 0:
            gap_categories_found.add(sq.category)

    assert len(gap_categories_found) > 0, (
        "Expected knowledge_gaps to be non-empty for empty retrieval"
    )


@pytest.mark.eval_full
async def test_expired_knowledge_gap_detected(
    qdrant_test_client,
    test_collection_name: str,
    fake_provider,
    all_fixture_data: list[list[dict]],
) -> None:
    if not await collection_exists(qdrant_test_client, test_collection_name):
        await create_collection(qdrant_test_client, test_collection_name, vector_size=3072)
        await create_payload_indexes(qdrant_test_client, test_collection_name)

    await upsert_all_fixtures(qdrant_test_client, test_collection_name, all_fixture_data, fake_provider)

    ctx = RetrievalQueryContext(
        business_type="hospitality",
        market="egypt",
        locale="en",
        objective="acquisition",
        funnel_stage="acquisition",
        active_channels=[],
        asset_capability=[],
        team_capacity="medium",
        budget_mode="scenario_only",
        industry="hospitality",
    )
    subqueries = build_subqueries(ctx)
    now = datetime.utcnow()
    gap_categories_found = set()
    for sq in subqueries:
        q_filter = build_category_filter(sq, now)
        vector = (await fake_provider.embed(EmbedRequest(texts=[sq.text]))).embeddings[0].vector
        results = await search_points(
            qdrant_test_client,
            test_collection_name,
            vector=vector,
            query_filter=q_filter,
            limit=5,
        )
        if len(results) == 0:
            gap_categories_found.add(sq.category)

    assert len(gap_categories_found) > 0, (
        "Expected expired knowledge to produce gaps"
    )


@pytest.mark.eval_full
async def test_incompatible_locale_gap_detected(
    qdrant_test_client,
    test_collection_name: str,
    fake_provider,
    all_fixture_data: list[list[dict]],
) -> None:
    if not await collection_exists(qdrant_test_client, test_collection_name):
        await create_collection(qdrant_test_client, test_collection_name, vector_size=3072)
        await create_payload_indexes(qdrant_test_client, test_collection_name)

    await upsert_all_fixtures(qdrant_test_client, test_collection_name, all_fixture_data, fake_provider)

    ctx = RetrievalQueryContext(
        business_type="retail",
        market="france",
        locale="ar-EG",
        objective="awareness",
        funnel_stage="awareness",
        active_channels=[],
        asset_capability=[],
        team_capacity="low",
        budget_mode="organic_only",
        industry="retail",
    )
    subqueries = build_subqueries(ctx)
    now = datetime.utcnow()
    gap_categories_found = set()
    for sq in subqueries:
        q_filter = build_category_filter(sq, now)
        vector = (await fake_provider.embed(EmbedRequest(texts=[sq.text]))).embeddings[0].vector
        results = await search_points(
            qdrant_test_client,
            test_collection_name,
            vector=vector,
            query_filter=q_filter,
            limit=5,
        )
        if len(results) == 0:
            gap_categories_found.add(sq.category)

    assert len(gap_categories_found) > 0, (
        "Expected incompatible-locale queries to produce gaps"
    )


@pytest.mark.eval_full
@pytest.mark.xfail(reason="Fake embeddings provider matches subquery texts against fixture data")
async def test_no_false_positives_for_missing_knowledge(
    qdrant_test_client,
    test_collection_name: str,
    fake_provider,
    all_fixture_data: list[list[dict]],
    eval_dataset,
) -> None:
    if not await collection_exists(qdrant_test_client, test_collection_name):
        await create_collection(qdrant_test_client, test_collection_name, vector_size=3072)
        await create_payload_indexes(qdrant_test_client, test_collection_name)

    await upsert_all_fixtures(qdrant_test_client, test_collection_name, all_fixture_data, fake_provider)

    now = datetime.utcnow()
    false_positives = []

    for case in eval_dataset.cases:
        expected = case.expected_retrieval
        if len(expected.expected_chunk_ids) > 0:
            continue
        ctx = RetrievalQueryContext(
            business_type=case.query_input.business_type,
            market=case.query_input.market,
            locale=case.query_input.locale,
            objective=case.query_input.objective,
            funnel_stage=case.query_input.funnel_stage,
            active_channels=case.query_input.active_channels,
            asset_capability=case.query_input.asset_capability,
            team_capacity=case.query_input.team_capacity,
            budget_mode=case.query_input.budget_mode,
            industry=case.query_input.industry,
        )
        subqueries = build_subqueries(ctx)
        gap_categories_found = set()
        for sq in subqueries:
            q_filter = build_category_filter(sq, now)
            vector = (await fake_provider.embed(EmbedRequest(texts=[sq.text]))).embeddings[0].vector
            results = await search_points(
                qdrant_test_client,
                test_collection_name,
                vector=vector,
                query_filter=q_filter,
                limit=5,
            )
            if len(results) == 0:
                gap_categories_found.add(sq.category)
        missing_gaps = set(expected.required_gap_categories) - gap_categories_found
        for gap in missing_gaps:
            false_positives.append(f"{case.id}: expected gap '{gap}' but got results")

    if false_positives:
        pytest.fail("\n".join(false_positives))
