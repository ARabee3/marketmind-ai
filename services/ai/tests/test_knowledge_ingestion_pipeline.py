"""Integration tests for the knowledge ingestion pipeline.

These tests exercise the full pipeline against a real PostgreSQL database and
Qdrant instance. They are marked as `integration` and skipped when those
services are not reachable.
"""

from __future__ import annotations

import uuid
from pathlib import Path
from typing import Any

import pytest

from app.core.config import Settings
from app.db.client import create_async_engine_from_settings
from app.knowledge.ingestion.pipeline import _persist_entry, run_ingestion_pipeline
from app.qdrant.client import create_qdrant_client
from app.qdrant.points import count_points, search_points


pytestmark = pytest.mark.integration


_SAMPLE_ENTRY = """---
slug: {slug}
version: 1
kind: framework
title: Pipeline Test Entry
summary: A short entry used to exercise the ingestion pipeline.
locale: en
markets: [egypt]
industries: [retail]
business_models: [b2c]
objectives: [awareness]
funnel_stages: [awareness]
channels: [facebook]
seasons: []
budget_modes: []
evidence_tier: reviewed_guidance
review_status: approved
source_references:
  - internal:reviewed-marketing-methodology
effective_at: "2026-01-01"
expires_at: "2027-01-01"
author: tester
reviewer: reviewer-1
reviewed_at: "2026-01-01"
checksum: ""
---

# Pipeline Test Entry

This is a test entry for the ingestion pipeline.

## Section 1

Some content here to ensure the chunker has material to work with.

- Point one
- Point two
"""


def _write_corpus(root: Path, entries: dict[str, str]) -> Path:
    """Write a minimal corpus to a temporary directory.

    Any existing files are removed first so callers can simulate a removed entry.
    """
    source_dir = root / "knowledge"
    source_dir.mkdir(parents=True, exist_ok=True)
    for existing in source_dir.iterdir():
        if existing.is_file():
            existing.unlink()
    for filename, content in entries.items():
        (source_dir / filename).write_text(content, encoding="utf-8")
    return source_dir


async def _cleanup_db(settings: Settings) -> None:
    """Remove all rows from the marketing knowledge tables."""
    from sqlalchemy import text

    engine = create_async_engine_from_settings(settings)
    try:
        async with engine.begin() as conn:
            for table in [
                "marketing_knowledge_chunks",
                "marketing_knowledge_source_refs",
                "marketing_knowledge_entry_versions",
                "marketing_knowledge_entries",
                "marketing_knowledge_ingestion_errors",
                "marketing_knowledge_ingestion_runs",
            ]:
                await conn.execute(text(f'DELETE FROM "{table}"'))
    finally:
        await engine.dispose()


@pytest.fixture
async def pipeline_test_settings() -> Settings:
    """Return settings bound to unique test resources."""
    return Settings(
        database_url="postgresql://marketmind:marketmind_dev@localhost:5433/marketmind_dev?schema=public",
        knowledge_internal_cli_token="test-token",
        knowledge_source_dir="knowledge",
        knowledge_strict_sources=False,
        embedding_provider_mode="fake",
        embedding_model="text-embedding-3-large",
        embedding_dimensions=3072,
        qdrant_host="localhost",
        qdrant_port=6333,
        qdrant_collection_name=f"test_pipeline_{uuid.uuid4().hex[:12]}",
    )


@pytest.fixture
async def clean_db(pipeline_test_settings: Settings) -> None:
    """Ensure the marketing knowledge tables are empty before and after a test."""
    await _cleanup_db(pipeline_test_settings)
    yield
    await _cleanup_db(pipeline_test_settings)


@pytest.fixture
async def pipeline_qdrant_client(pipeline_test_settings: Settings):
    """Provide a Qdrant client for the test collection and clean it up."""
    client = create_qdrant_client(pipeline_test_settings)
    try:
        await client.get_collections()
    except Exception as exc:
        pytest.skip(f"Qdrant is not reachable: {exc}")

    try:
        yield client
    finally:
        try:
            await client.delete_collection(
                collection_name=pipeline_test_settings.qdrant_collection_name
            )
        except Exception:
            pass
        await client.close()


def _make_settings_with_root(
    base: Settings, root: Path
) -> Settings:
    """Return a copy of settings with a test corpus root."""
    return Settings(
        **{
            **base.model_dump(),
            "knowledge_source_dir": "knowledge",
        }
    )


@pytest.mark.asyncio
async def test_pipeline_dry_run_does_not_write_to_db_or_qdrant(
    tmp_path: Path,
    pipeline_test_settings: Settings,
    clean_db: Any,
    pipeline_qdrant_client: Any,
) -> None:
    """Dry-run mode validates and reports without persisting anything."""
    slug = f"dry-run-{uuid.uuid4().hex[:8]}"
    _write_corpus(tmp_path, {f"{slug}.md": _SAMPLE_ENTRY.format(slug=slug)})
    settings = _make_settings_with_root(pipeline_test_settings, tmp_path)

    report = await run_ingestion_pipeline(
        cli_token="test-token",
        actor="tester",
        dry_run=True,
        repo_root=str(tmp_path),
        settings=settings,
    )

    assert report.status == "dry_run"
    assert report.entered_count == 1
    assert report.entries[0].slug == slug
    assert report.entries[0].chunk_count > 0

    # No DB rows should have been written.
    from sqlalchemy import text

    engine = create_async_engine_from_settings(settings)
    try:
        async with engine.connect() as conn:
            result = await conn.execute(
                text('SELECT COUNT(*) FROM "marketing_knowledge_entries"')
            )
            assert result.scalar() == 0
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_pipeline_ingests_new_entry(
    tmp_path: Path,
    pipeline_test_settings: Settings,
    clean_db: Any,
    pipeline_qdrant_client: Any,
) -> None:
    """A full run creates entry, version, chunks, run record, and Qdrant points."""
    slug = f"new-entry-{uuid.uuid4().hex[:8]}"
    _write_corpus(tmp_path, {f"{slug}.md": _SAMPLE_ENTRY.format(slug=slug)})
    settings = _make_settings_with_root(pipeline_test_settings, tmp_path)

    report = await run_ingestion_pipeline(
        cli_token="test-token",
        actor="tester",
        commit_sha="abc123",
        repo_root=str(tmp_path),
        settings=settings,
    )

    assert report.status == "succeeded"
    assert report.entered_count == 1
    assert report.updated_count == 0
    assert len(report.entries) == 1
    assert report.entries[0].status == "new"
    assert report.entries[0].chunk_count > 0


@pytest.mark.asyncio
async def test_pipeline_skips_unchanged_entry_on_second_run(
    tmp_path: Path,
    pipeline_test_settings: Settings,
    clean_db: Any,
    pipeline_qdrant_client: Any,
) -> None:
    """Running twice with identical content marks the entry as skipped."""
    slug = f"unchanged-{uuid.uuid4().hex[:8]}"
    _write_corpus(tmp_path, {f"{slug}.md": _SAMPLE_ENTRY.format(slug=slug)})
    settings = _make_settings_with_root(pipeline_test_settings, tmp_path)

    first = await run_ingestion_pipeline(
        cli_token="test-token",
        actor="tester",
        repo_root=str(tmp_path),
        settings=settings,
    )
    assert first.status == "succeeded"
    assert first.entered_count == 1

    second = await run_ingestion_pipeline(
        cli_token="test-token",
        actor="tester",
        repo_root=str(tmp_path),
        settings=settings,
    )
    assert second.status == "succeeded"
    assert second.skipped_count == 1
    assert second.entered_count == 0
    assert second.updated_count == 0


@pytest.mark.asyncio
async def test_pipeline_updates_changed_entry(
    tmp_path: Path,
    pipeline_test_settings: Settings,
    clean_db: Any,
    pipeline_qdrant_client: Any,
) -> None:
    """Changing body content produces a new version for the same entry."""
    slug = f"updated-{uuid.uuid4().hex[:8]}"
    original = _SAMPLE_ENTRY.format(slug=slug)
    _write_corpus(tmp_path, {f"{slug}.md": original})
    settings = _make_settings_with_root(pipeline_test_settings, tmp_path)

    first = await run_ingestion_pipeline(
        cli_token="test-token",
        actor="tester",
        repo_root=str(tmp_path),
        settings=settings,
    )
    assert first.status == "succeeded"
    assert first.entered_count == 1

    updated = original.replace("- Point two", "- Point two\n- Point three")
    _write_corpus(tmp_path, {f"{slug}.md": updated})

    second = await run_ingestion_pipeline(
        cli_token="test-token",
        actor="tester",
        repo_root=str(tmp_path),
        settings=settings,
    )
    assert second.status == "succeeded"
    assert second.updated_count == 1
    assert second.entered_count == 0
    assert second.entries[0].previous_version == 1
    assert second.entries[0].new_version == 2


@pytest.mark.asyncio
async def test_pipeline_retires_removed_entries(
    tmp_path: Path,
    pipeline_test_settings: Settings,
    clean_db: Any,
    pipeline_qdrant_client: Any,
) -> None:
    """Removing a file from the corpus retires the corresponding entry."""
    slug = f"removed-{uuid.uuid4().hex[:8]}"
    _write_corpus(tmp_path, {f"{slug}.md": _SAMPLE_ENTRY.format(slug=slug)})
    settings = _make_settings_with_root(pipeline_test_settings, tmp_path)

    first = await run_ingestion_pipeline(
        cli_token="test-token",
        actor="tester",
        repo_root=str(tmp_path),
        settings=settings,
    )
    assert first.status == "succeeded"
    assert first.entered_count == 1

    # Empty the corpus.
    _write_corpus(tmp_path, {})

    second = await run_ingestion_pipeline(
        cli_token="test-token",
        actor="tester",
        repo_root=str(tmp_path),
        settings=settings,
    )
    assert second.status == "succeeded"
    assert any(e.status == "retired" for e in second.entries)


@pytest.mark.asyncio
async def test_pipeline_qdrant_roundtrip_after_ingest(
    tmp_path: Path,
    pipeline_test_settings: Settings,
    clean_db: Any,
    pipeline_qdrant_client: Any,
) -> None:
    """After ingestion, Qdrant contains the expected points with payloads."""
    slug = f"qdrant-roundtrip-{uuid.uuid4().hex[:8]}"
    _write_corpus(tmp_path, {f"{slug}.md": _SAMPLE_ENTRY.format(slug=slug)})
    settings = _make_settings_with_root(pipeline_test_settings, tmp_path)

    report = await run_ingestion_pipeline(
        cli_token="test-token",
        actor="tester",
        repo_root=str(tmp_path),
        settings=settings,
    )
    assert report.status == "succeeded"
    chunk_count = report.entries[0].chunk_count
    assert chunk_count > 0

    client = create_qdrant_client(settings)
    try:
        total = await count_points(client, settings.qdrant_collection_name)
        assert total == chunk_count

        # Search with a zero vector should return the chunk(s).
        points = await search_points(
            client,
            settings.qdrant_collection_name,
            vector=[0.0] * settings.embedding_dimensions,
            limit=10,
        )
        assert len(points) == chunk_count
        assert points[0].payload is not None
        assert points[0].payload.get("text")
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_pipeline_retired_entry_not_in_approved_search(
    tmp_path: Path,
    pipeline_test_settings: Settings,
    clean_db: Any,
    pipeline_qdrant_client: Any,
) -> None:
    """A retired entry's Qdrant points are not returned by approved-only search."""
    slug = f"retired-search-{uuid.uuid4().hex[:8]}"
    _write_corpus(tmp_path, {f"{slug}.md": _SAMPLE_ENTRY.format(slug=slug)})
    settings = _make_settings_with_root(pipeline_test_settings, tmp_path)

    first = await run_ingestion_pipeline(
        cli_token="test-token",
        actor="tester",
        repo_root=str(tmp_path),
        settings=settings,
    )
    assert first.status == "succeeded"

    # Remove the entry from the corpus so it gets retired.
    _write_corpus(tmp_path, {})
    second = await run_ingestion_pipeline(
        cli_token="test-token",
        actor="tester",
        repo_root=str(tmp_path),
        settings=settings,
    )
    assert second.status == "succeeded"

    client = create_qdrant_client(settings)
    try:
        from qdrant_client.models import FieldCondition, Filter, MatchValue

        approved_count = await count_points(
            client,
            settings.qdrant_collection_name,
            query_filter=Filter(
                must=[
                    FieldCondition(
                        key="review_status",
                        match=MatchValue(value="approved"),
                    ),
                    FieldCondition(
                        key="slug",
                        match=MatchValue(value=slug),
                    ),
                ]
            ),
        )
        assert approved_count == 0
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_pipeline_strict_sources_fails_on_unresolvable_url(
    tmp_path: Path,
    pipeline_test_settings: Settings,
    clean_db: Any,
    pipeline_qdrant_client: Any,
) -> None:
    """Strict source resolution fails the run when a URL cannot be reached."""
    slug = f"strict-sources-{uuid.uuid4().hex[:8]}"
    content = _SAMPLE_ENTRY.format(slug=slug).replace(
        "internal:reviewed-marketing-methodology",
        "https://example.invalid/surely-does-not-resolve-12345",
    )
    _write_corpus(tmp_path, {f"{slug}.md": content})
    settings = _make_settings_with_root(pipeline_test_settings, tmp_path)
    settings.knowledge_strict_sources = True

    report = await run_ingestion_pipeline(
        cli_token="test-token",
        actor="tester",
        repo_root=str(tmp_path),
        strict_sources=True,
        settings=settings,
    )

    assert report.status == "failed"
    assert any(
        e["code"] == "SOURCE_RESOLUTION_FAILED" for e in report.errors
    )


@pytest.mark.asyncio
async def test_pipeline_partial_failure_continues_for_other_entries(
    tmp_path: Path,
    pipeline_test_settings: Settings,
    clean_db: Any,
    pipeline_qdrant_client: Any,
    monkeypatch: Any,
) -> None:
    """If one entry fails to persist, the pipeline continues with the others."""
    good_slug = f"good-{uuid.uuid4().hex[:8]}"
    bad_slug = f"bad-{uuid.uuid4().hex[:8]}"
    _write_corpus(
        tmp_path,
        {
            f"{good_slug}.md": _SAMPLE_ENTRY.format(slug=good_slug),
            f"{bad_slug}.md": _SAMPLE_ENTRY.format(slug=bad_slug),
        },
    )
    settings = _make_settings_with_root(pipeline_test_settings, tmp_path)

    original_persist = _persist_entry

    async def failing_persist(*args, **kwargs):
        # args[1] is the parsed entry in the current signature.
        parsed = args[1]
        if parsed.slug == bad_slug:
            raise RuntimeError("simulated persist failure")
        return await original_persist(*args, **kwargs)

    monkeypatch.setattr(
        "app.knowledge.ingestion.pipeline._persist_entry", failing_persist
    )

    report = await run_ingestion_pipeline(
        cli_token="test-token",
        actor="tester",
        repo_root=str(tmp_path),
        settings=settings,
    )

    assert report.status == "partial_failure"
    assert report.entered_count == 1
    assert report.failed_count == 1
    assert any(e["slug"] == bad_slug for e in report.errors)
    assert any(e.slug == good_slug and e.status == "new" for e in report.entries)


@pytest.mark.asyncio
async def test_pipeline_rebuild_reindexes_approved_versions(
    tmp_path: Path,
    pipeline_test_settings: Settings,
    clean_db: Any,
    pipeline_qdrant_client: Any,
) -> None:
    """The rebuild command re-indexes approved live versions into Qdrant."""
    slug = f"rebuild-{uuid.uuid4().hex[:8]}"
    _write_corpus(tmp_path, {f"{slug}.md": _SAMPLE_ENTRY.format(slug=slug)})
    settings = _make_settings_with_root(pipeline_test_settings, tmp_path)

    ingest_report = await run_ingestion_pipeline(
        cli_token="test-token",
        actor="tester",
        repo_root=str(tmp_path),
        settings=settings,
    )
    assert ingest_report.status == "succeeded"

    # Reset Qdrant collection so rebuild has work to do.
    client = create_qdrant_client(settings)
    try:
        await client.delete_collection(collection_name=settings.qdrant_collection_name)
    finally:
        await client.close()

    from app.knowledge.ingestion.rebuild import rebuild_qdrant_index

    rebuild_report = await rebuild_qdrant_index(
        cli_token="test-token",
        actor="tester",
        collection_name=settings.qdrant_collection_name,
        settings=settings,
    )

    assert rebuild_report.status == "succeeded"
    assert rebuild_report.entries_processed == 1
    assert rebuild_report.chunks_processed == ingest_report.entries[0].chunk_count

    client = create_qdrant_client(settings)
    try:
        total = await count_points(client, settings.qdrant_collection_name)
        assert total == ingest_report.entries[0].chunk_count
    finally:
        await client.close()
