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
    url, connect_args = _to_asyncpg_url("postgresql://user:pass@localhost:5432/db")
    assert url == "postgresql+asyncpg://user:pass@localhost:5432/db"
    assert connect_args == {}


def test_to_asyncpg_url_leaves_asyncpg_url_unchanged():
    url_in = "postgresql+asyncpg://user:pass@localhost:5432/db"
    url, connect_args = _to_asyncpg_url(url_in)
    assert url == url_in
    assert connect_args == {}


def test_to_asyncpg_url_extracts_schema_param():
    url, connect_args = _to_asyncpg_url(
        "postgresql://user:pass@localhost:5432/db?schema=public"
    )
    assert url == "postgresql+asyncpg://user:pass@localhost:5432/db"
    assert connect_args == {"server_settings": {"search_path": "public"}}


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
        chunk_id=uuid4(),
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
