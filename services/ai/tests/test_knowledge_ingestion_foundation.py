import pytest
from uuid import uuid4

from app.db.client import _to_asyncpg_url
from app.db.models import (
    MarketingKnowledgeEntry,
    MarketingKnowledgeEntryVersion,
    MarketingKnowledgeChunk,
    MarketingKnowledgeIngestionRun,
)
from app.knowledge.ingestion.errors import IngestionError, IngestionErrorCode
from app.knowledge.ingestion.schemas import IngestionReport


def test_to_asyncpg_url_converts_standard_url():
    assert (
        _to_asyncpg_url("postgresql://user:pass@localhost:5432/db")
        == "postgresql+asyncpg://user:pass@localhost:5432/db"
    )


def test_to_asyncpg_url_leaves_asyncpg_url_unchanged():
    url = "postgresql+asyncpg://user:pass@localhost:5432/db"
    assert _to_asyncpg_url(url) == url


def test_to_asyncpg_url_preserves_query_params():
    url = "postgresql://user:pass@localhost:5432/db?schema=public"
    assert _to_asyncpg_url(url) == "postgresql+asyncpg://user:pass@localhost:5432/db?schema=public"


def test_marketing_knowledge_entry_instantiation():
    entry = MarketingKnowledgeEntry(slug="test-entry", latest_version=0)
    assert entry.slug == "test-entry"
    assert entry.latest_version == 0


def test_marketing_knowledge_version_instantiation():
    version = MarketingKnowledgeEntryVersion(
        entry_id=uuid4(),
        version=1,
        kind="framework",
        title="Test",
        summary="Summary",
        body="Body",
        locale="mixed",
        evidence_tier="reviewed_guidance",
        review_status="draft",
        effective_at="2026-01-01",
        author="test",
        checksum="abc123",
    )
    assert version.version == 1
    assert version.kind == "framework"


def test_marketing_knowledge_chunk_instantiation():
    chunk = MarketingKnowledgeChunk(
        entry_version_id=uuid4(),
        chunk_order=0,
        text="chunk text",
        token_count=10,
        checksum="abc",
        embedding_provider="fake",
        embedding_model="text-embedding-3-large",
        embedding_dimensions=3072,
        embedding_version="embedding-v1",
    )
    assert chunk.token_count == 10


def test_ingestion_run_instantiation():
    run = MarketingKnowledgeIngestionRun(
        actor="tester", status="pending", configuration={"dry_run": False}
    )
    assert run.actor == "tester"
    assert run.status == "pending"
    assert run.configuration == {"dry_run": False}


def test_ingestion_error_string_with_context():
    err = IngestionError(
        code=IngestionErrorCode.INVALID_METADATA,
        message="missing slug",
        slug="my-entry",
        version=2,
    )
    assert err.code == "INVALID_METADATA"
    assert "my-entry" in str(err)
    assert "2" in str(err)


def test_ingestion_report_to_dict():
    report = IngestionReport(
        run_id=uuid4(),
        status="succeeded",
        actor="tester",
        commit_sha="abc123",
        configuration={"dry_run": True},
    )
    data = report.to_dict()
    assert data["status"] == "succeeded"
    assert data["configuration"]["dry_run"] is True
    assert isinstance(data["run_id"], str)
