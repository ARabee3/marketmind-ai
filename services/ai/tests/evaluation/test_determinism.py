from datetime import datetime

import pytest

from app.embeddings import EmbedRequest, EmbeddingConfig
from app.embeddings.fake_provider import DeterministicFakeEmbeddingProvider

from tests.evaluation.conftest import eval_dataset, all_fixture_data, upsert_all_fixtures
from tests.evaluation.runner.retrieval_runner import RetrievalEvalRunner


@pytest.fixture
def fake_provider_deterministic() -> DeterministicFakeEmbeddingProvider:
    return DeterministicFakeEmbeddingProvider(
        EmbeddingConfig(
            provider="fake",
            model="text-embedding-3-large",
            dimensions=3072,
            batch_size=32,
        )
    )


@pytest.mark.eval_smoke
async def test_fake_embedding_deterministic(
    fake_provider_deterministic: DeterministicFakeEmbeddingProvider,
) -> None:
    text = "Marketing playbook for retail acquisition in Egypt."
    emb1 = await fake_provider_deterministic.embed(EmbedRequest(texts=[text]))
    emb2 = await fake_provider_deterministic.embed(EmbedRequest(texts=[text]))

    vec1 = emb1.embeddings[0].vector
    vec2 = emb2.embeddings[0].vector

    assert vec1 == vec2, "Fake embedding provider should produce identical vectors for identical input"


@pytest.mark.eval_smoke
async def test_fake_embedding_different_inputs_different_vectors(
    fake_provider_deterministic: DeterministicFakeEmbeddingProvider,
) -> None:
    text_a = "Marketing playbook for retail."
    text_b = "Channel playbook for Instagram."
    emb_a = await fake_provider_deterministic.embed(EmbedRequest(texts=[text_a]))
    emb_b = await fake_provider_deterministic.embed(EmbedRequest(texts=[text_b]))

    vec_a = emb_a.embeddings[0].vector
    vec_b = emb_b.embeddings[0].vector

    assert vec_a != vec_b, "Different inputs should produce different vectors"


@pytest.mark.eval_full
async def test_full_dataset_determinism(
    qdrant_test_client,
    test_collection_name: str,
    fake_provider,
    eval_dataset,
    all_fixture_data: list[list[dict]],
) -> None:
    runner = RetrievalEvalRunner(qdrant_test_client, test_collection_name, fake_provider)
    await runner.ensure_collection()
    await runner.load_fixtures(all_fixture_data)

    now = datetime.utcnow()
    report_1 = await runner.run_dataset(eval_dataset.cases, now=now)
    report_2 = await runner.run_dataset(eval_dataset.cases, now=now)

    assert report_1.cases_passed == report_2.cases_passed, "Pass/fail counts differ between runs"
    assert report_1.cases_failed == report_2.cases_failed, "Pass/fail counts differ between runs"
    assert report_1.top5_hit_rate == report_2.top5_hit_rate, "Top-5 rates differ between runs"
    # Wall-clock latency is deliberately reported, but is not deterministic.

    for i, (pc1, pc2) in enumerate(zip(report_1.per_case, report_2.per_case)):
        assert pc1["id"] == pc2["id"], f"Case order differs at index {i}"
        assert pc1["passed"] == pc2["passed"], f"Pass/fail differs for {pc1['id']}"
        assert pc1["top5_hit"] == pc2["top5_hit"], f"Top-5 hit differs for {pc1['id']}"
        assert pc1["forbidden_violation"] == pc2["forbidden_violation"], f"Forbidden violation differs for {pc1['id']}"
        assert pc1["failure_category"] == pc2["failure_category"], f"Failure category differs for {pc1['id']}"

    for r1, r2 in zip(report_1.retrieval_results, report_2.retrieval_results):
        for sq1, sq2 in zip(r1.subquery_results, r2.subquery_results):
            assert sq1.returned_chunk_ids == sq2.returned_chunk_ids, (
                f"Subquery result order differs for {r1.case_id}/{sq1.subquery_category}"
            )
