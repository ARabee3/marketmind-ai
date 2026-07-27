import json
from pathlib import Path
from uuid import UUID

import pytest
from qdrant_client import AsyncQdrantClient

from app.embeddings import EmbedRequest, EmbeddingConfig, EmbeddingProvider
from app.embeddings.fake_provider import DeterministicFakeEmbeddingProvider
from app.qdrant import QdrantKnowledgePoint, upsert_points

from tests.evaluation.dataset.schema import EvalCase, EvalDataset

FIXTURES_DIR = Path(__file__).parent / "fixtures"
DATASET_DIR = Path(__file__).parent / "dataset"


@pytest.fixture
async def qdrant_test_client():
    """Use Qdrant's local mode so evaluation CI is deterministic and free."""
    client = AsyncQdrantClient(location=":memory:")
    try:
        yield client
    finally:
        await client.close()


def _load_json(path: Path) -> list[dict]:
    with open(path) as f:
        return json.load(f)


@pytest.fixture(scope="session")
def knowledge_base_fixture() -> list[dict]:
    return _load_json(FIXTURES_DIR / "knowledge_base.json")


@pytest.fixture(scope="session")
def expired_knowledge_fixture() -> list[dict]:
    return _load_json(FIXTURES_DIR / "expired_knowledge.json")


@pytest.fixture(scope="session")
def unapproved_knowledge_fixture() -> list[dict]:
    return _load_json(FIXTURES_DIR / "unapproved_knowledge.json")


@pytest.fixture(scope="session")
def privacy_profile_fixture() -> dict:
    return _load_json(FIXTURES_DIR / "privacy_profile.json")


@pytest.fixture(scope="session")
def all_fixture_data(
    knowledge_base_fixture: list[dict],
    expired_knowledge_fixture: list[dict],
    unapproved_knowledge_fixture: list[dict],
) -> list[list[dict]]:
    return [knowledge_base_fixture, expired_knowledge_fixture, unapproved_knowledge_fixture]


@pytest.fixture
def eval_dataset() -> EvalDataset:
    return _load_all_cases()


def _load_all_cases() -> EvalDataset:
    case_files = sorted(DATASET_DIR.glob("cases_*.json"))
    all_cases: list[dict] = []
    version = "eval-v1"
    created_at = "2026-07-15"
    for path in case_files:
        with open(path) as f:
            data = json.load(f)
            version = data.get("version", version)
            created_at = data.get("created_at", created_at)
            all_cases.extend(data["cases"])
    return EvalDataset(version=version, cases=[EvalCase(**c) for c in all_cases], created_at=created_at)


@pytest.fixture
def fake_provider() -> DeterministicFakeEmbeddingProvider:
    return DeterministicFakeEmbeddingProvider(
        EmbeddingConfig(
            provider="fake",
            model="text-embedding-3-large",
            dimensions=3072,
            batch_size=32,
        )
    )


async def upsert_fixture_points(
    qdrant_client,
    collection_name: str,
    fixture: list[dict],
    provider: EmbeddingProvider,
) -> None:
    texts = [p["text"] for p in fixture]
    embeddings = await provider.embed(EmbedRequest(texts=texts))
    kps_and_vecs = []
    for idx, p in enumerate(fixture):
        from datetime import datetime
        kp = QdrantKnowledgePoint(
            chunk_id=UUID(p["chunk_id"]),
            entry_id=UUID(p["entry_id"]),
            entry_version=p["entry_version"],
            checksum=p["checksum"],
            text=p["text"],
            kind=p["kind"],
            locale=p.get("locale", "en"),
            markets=p.get("markets", []),
            industries=p.get("industries", []),
            channels=p.get("channels", []),
            budget_modes=p.get("budget_modes", []),
            evidence_tier=p["evidence_tier"],
            review_status=p["review_status"],
            effective_at=datetime.fromisoformat(p["effective_at"]),
            expires_at=datetime.fromisoformat(p["expires_at"]) if p.get("expires_at") else None,
        )
        kps_and_vecs.append((kp, embeddings.embeddings[idx].vector))
    await upsert_points(qdrant_client, collection_name, kps_and_vecs)


async def upsert_all_fixtures(
    qdrant_client,
    collection_name: str,
    all_fixtures: list[list[dict]],
    provider: EmbeddingProvider,
) -> None:
    for fixture in all_fixtures:
        await upsert_fixture_points(qdrant_client, collection_name, fixture, provider)
