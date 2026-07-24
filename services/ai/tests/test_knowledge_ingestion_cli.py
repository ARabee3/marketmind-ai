"""Tests for the knowledge ingestion CLI.

Unit tests exercise argument parsing and fast failure paths.
Integration tests exercise real pipeline runs via the CLI.
"""

from __future__ import annotations

import asyncio
import json
import uuid
from pathlib import Path
from typing import Any

import pytest
from typer.testing import CliRunner

from app.core.config import Settings
from app.knowledge.ingestion.cli import app
from app.qdrant.client import create_qdrant_client
from app.qdrant.points import count_points


runner = CliRunner()


@pytest.fixture
async def clean_db() -> None:
    """Remove all rows from the marketing knowledge tables before and after a test."""
    from app.core.config import Settings
    from app.db.client import create_async_engine_from_settings
    from sqlalchemy import text

    settings = Settings()
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
    yield
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


def test_cli_help_shows_commands():
    result = runner.invoke(app, ["--help"])
    assert result.exit_code == 0
    assert "ingest" in result.output
    assert "dry-run" in result.output
    assert "rebuild" in result.output
    assert "db-ready" in result.output


def test_cli_fails_when_token_missing(monkeypatch):
    monkeypatch.setenv("KNOWLEDGE_INTERNAL_CLI_TOKEN", "")
    result = runner.invoke(app, ["dry-run"])
    assert result.exit_code == 1
    assert "CLI authentication token is required" in result.output


def test_cli_uses_token_from_environment(monkeypatch, tmp_path: Path):
    monkeypatch.setenv("KNOWLEDGE_INTERNAL_CLI_TOKEN", "env-token")
    # Point source_dir at an empty temp directory so validation fails quickly
    # with no entries, but auth passes.
    (tmp_path / "knowledge").mkdir()
    result = runner.invoke(
        app,
        [
            "dry-run",
            "--source-dir",
            "knowledge",
            "--repo-root",
            str(tmp_path),
        ],
    )
    # Empty corpus is valid; report succeeds with 0 entries.
    assert result.exit_code == 0
    data = json.loads(result.output)
    assert data["status"] == "dry_run"
    assert data["entered_count"] == 0


@pytest.mark.integration
def test_cli_ingest_command_runs_pipeline(
    tmp_path: Path,
    monkeypatch,
    clean_db: Any,
) -> None:
    """Integration: the ingest command persists a minimal corpus."""
    slug = f"cli-integ-{uuid.uuid4().hex[:8]}"
    source = """---
slug: {slug}
version: 1
kind: framework
title: CLI Integration Entry
summary: A short entry.
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

# CLI Integration Entry

Body content for the CLI integration test.

- Point one
- Point two
""".format(slug=slug)

    knowledge_dir = tmp_path / "knowledge"
    knowledge_dir.mkdir()
    (knowledge_dir / f"{slug}.md").write_text(source, encoding="utf-8")

    collection = f"test_cli_{uuid.uuid4().hex[:8]}"
    monkeypatch.setenv("KNOWLEDGE_INTERNAL_CLI_TOKEN", "test-token")
    monkeypatch.setenv("QDRANT_COLLECTION_NAME", collection)

    result = runner.invoke(
        app,
        [
            "ingest",
            "--source-dir",
            "knowledge",
            "--repo-root",
            str(tmp_path),
            "--no-strict-sources",
            "--skip-db-ready",
            "--actor",
            "cli-test",
            "--commit-sha",
            "abc123",
        ],
    )

    assert result.exit_code == 0, result.output
    data = json.loads(result.output)
    assert data["status"] == "succeeded"
    assert data["entered_count"] == 1
    assert data["entries"][0]["slug"] == slug


@pytest.mark.integration
def test_cli_dry_run_command_reports_without_writes(
    tmp_path: Path,
    monkeypatch,
    clean_db: Any,
) -> None:
    """Integration: dry-run does not write to DB or Qdrant."""
    slug = f"cli-dry-{uuid.uuid4().hex[:8]}"
    source = """---
slug: {slug}
version: 1
kind: framework
title: CLI Dry Run Entry
summary: A short entry.
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

# CLI Dry Run Entry

Body content.
""".format(slug=slug)

    knowledge_dir = tmp_path / "knowledge"
    knowledge_dir.mkdir()
    (knowledge_dir / f"{slug}.md").write_text(source, encoding="utf-8")

    monkeypatch.setenv("KNOWLEDGE_INTERNAL_CLI_TOKEN", "test-token")

    result = runner.invoke(
        app,
        [
            "dry-run",
            "--source-dir",
            "knowledge",
            "--repo-root",
            str(tmp_path),
            "--no-strict-sources",
        ],
    )

    assert result.exit_code == 0, result.output
    data = json.loads(result.output)
    assert data["status"] == "dry_run"
    assert data["entered_count"] == 1
    assert data["entries"][0]["slug"] == slug


@pytest.mark.integration
def test_cli_rebuild_command_reindexes_approved_versions(
    tmp_path: Path,
    monkeypatch,
    clean_db: Any,
) -> None:
    """Integration: the rebuild command re-indexes the approved corpus."""
    slug = f"cli-rebuild-{uuid.uuid4().hex[:8]}"
    source = """---
slug: {slug}
version: 1
kind: framework
title: CLI Rebuild Entry
summary: A short entry.
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

# CLI Rebuild Entry

Body content for the rebuild integration test.

- Point one
- Point two
""".format(slug=slug)

    knowledge_dir = tmp_path / "knowledge"
    knowledge_dir.mkdir()
    (knowledge_dir / f"{slug}.md").write_text(source, encoding="utf-8")

    collection = f"test_cli_rebuild_{uuid.uuid4().hex[:8]}"
    monkeypatch.setenv("KNOWLEDGE_INTERNAL_CLI_TOKEN", "test-token")
    monkeypatch.setenv("QDRANT_COLLECTION_NAME", collection)

    ingest_result = runner.invoke(
        app,
        [
            "ingest",
            "--source-dir",
            "knowledge",
            "--repo-root",
            str(tmp_path),
            "--no-strict-sources",
            "--skip-db-ready",
        ],
    )
    assert ingest_result.exit_code == 0, ingest_result.output
    ingest_data = json.loads(ingest_result.output)
    assert ingest_data["status"] == "succeeded"
    expected_chunks = ingest_data["entries"][0]["chunk_count"]

    async def _reset_qdrant() -> None:
        client = create_qdrant_client(Settings())
        try:
            await client.delete_collection(collection_name=collection)
        finally:
            await client.close()

    asyncio.run(_reset_qdrant())

    rebuild_result = runner.invoke(
        app,
        [
            "rebuild",
            "--skip-db-ready",
        ],
    )
    assert rebuild_result.exit_code == 0, rebuild_result.output
    rebuild_data = json.loads(rebuild_result.output)
    assert rebuild_data["status"] == "succeeded"
    assert rebuild_data["entries_processed"] == 1
    assert rebuild_data["chunks_processed"] == expected_chunks

    async def _verify_qdrant() -> None:
        client = create_qdrant_client(Settings())
        try:
            total = await count_points(client, collection)
            assert total == expected_chunks
        finally:
            await client.close()

    asyncio.run(_verify_qdrant())
