"""CLI for the MarketMind AI knowledge ingestion pipeline.

Examples:
    uv run python -m app.knowledge.ingestion.cli dry-run
    uv run python -m app.knowledge.ingestion.cli ingest --commit-sha $(git rev-parse HEAD)
    uv run python -m app.knowledge.ingestion.cli rebuild --token $TOKEN
"""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path
from typing import Optional

import typer
from rich.console import Console
from rich.panel import Panel

from app.core.config import Settings, get_settings
from app.knowledge.ingestion.pipeline import (
    ensure_database_schema,
    run_ingestion_pipeline,
)


app = typer.Typer(
    name="marketmind-knowledge",
    help="Idempotent ingestion CLI for the curated marketing knowledge corpus.",
    no_args_is_help=True,
)
console = Console()


def _load_settings() -> Settings:
    """Load settings from services/ai/.env and environment.

    A fresh instance is created on every CLI invocation so environment
    overrides (e.g., in tests) are always respected.
    """
    return Settings()


def _resolve_token(settings: Settings, token: Optional[str]) -> str:
    """Return the CLI token from the explicit option or the environment."""
    resolved = token or settings.knowledge_internal_cli_token
    if not resolved:
        console.print(
            Panel(
                "CLI authentication token is required.\n"
                "Pass --token or set KNOWLEDGE_INTERNAL_CLI_TOKEN in services/ai/.env",
                title="Authentication error",
                border_style="red",
            )
        )
        raise typer.Exit(code=1)
    return resolved


def _print_report(report: object) -> None:
    """Print the ingestion report as pretty JSON."""
    console.print_json(json.dumps(report.to_dict()))


def _exit_code_for_status(status: str) -> int:
    """Map ingestion status to a shell exit code."""
    if status == "succeeded":
        return 0
    if status == "dry_run":
        return 0
    if status == "partial_failure":
        return 2
    return 1


@app.command()
def ingest(
    token: Optional[str] = typer.Option(
        None,
        "--token",
        help="CLI authentication token (defaults to KNOWLEDGE_INTERNAL_CLI_TOKEN).",
    ),
    actor: str = typer.Option(
        "knowledge-cli",
        "--actor",
        help="Actor identifier recorded on the ingestion run.",
    ),
    commit_sha: Optional[str] = typer.Option(
        None,
        "--commit-sha",
        help="Git commit SHA to record on the ingestion run.",
    ),
    source_dir: Optional[str] = typer.Option(
        None,
        "--source-dir",
        help="Override the knowledge source directory.",
    ),
    strict_sources: Optional[bool] = typer.Option(
        None,
        "--strict-sources/--no-strict-sources",
        help="Override source reference resolution strictness.",
    ),
    repo_root: Optional[Path] = typer.Option(
        None,
        "--repo-root",
        help="Repository root used to resolve a relative source_dir.",
        exists=True,
        file_okay=False,
        dir_okay=True,
    ),
    collection: Optional[str] = typer.Option(
        None,
        "--collection",
        help="Override the Qdrant collection name.",
    ),
) -> None:
    """Run the full knowledge ingestion pipeline.

    Validates the corpus, persists new/updated entries to PostgreSQL, generates
    embeddings, and upserts chunks to Qdrant.
    """
    settings = _load_settings()
    if collection:
        settings.qdrant_collection_name = collection
    resolved_token = _resolve_token(settings, token)

    asyncio.run(ensure_database_schema(settings))

    async def _run() -> object:
        return await run_ingestion_pipeline(
            cli_token=resolved_token,
            actor=actor,
            commit_sha=commit_sha,
            source_dir=source_dir,
            strict_sources=strict_sources,
            repo_root=str(repo_root) if repo_root else None,
            dry_run=False,
            settings=settings,
        )

    report = asyncio.run(_run())
    _print_report(report)
    raise typer.Exit(code=_exit_code_for_status(report.status))


@app.command()
def dry_run(
    token: Optional[str] = typer.Option(
        None,
        "--token",
        help="CLI authentication token (defaults to KNOWLEDGE_INTERNAL_CLI_TOKEN).",
    ),
    actor: str = typer.Option(
        "knowledge-cli",
        "--actor",
        help="Actor identifier recorded on the ingestion run.",
    ),
    commit_sha: Optional[str] = typer.Option(
        None,
        "--commit-sha",
        help="Git commit SHA to record on the ingestion run.",
    ),
    source_dir: Optional[str] = typer.Option(
        None,
        "--source-dir",
        help="Override the knowledge source directory.",
    ),
    strict_sources: Optional[bool] = typer.Option(
        None,
        "--strict-sources/--no-strict-sources",
        help="Override source reference resolution strictness.",
    ),
    repo_root: Optional[Path] = typer.Option(
        None,
        "--repo-root",
        help="Repository root used to resolve a relative source_dir.",
        exists=True,
        file_okay=False,
        dir_okay=True,
    ),
    collection: Optional[str] = typer.Option(
        None,
        "--collection",
        help="Override the Qdrant collection name reported in the configuration.",
    ),
) -> None:
    """Validate the corpus and report what would be ingested.

    No database writes, embedding generation, or Qdrant calls are made.
    """
    settings = _load_settings()
    if collection:
        settings.qdrant_collection_name = collection
    resolved_token = _resolve_token(settings, token)

    async def _run() -> object:
        return await run_ingestion_pipeline(
            cli_token=resolved_token,
            actor=actor,
            commit_sha=commit_sha,
            source_dir=source_dir,
            strict_sources=strict_sources,
            repo_root=str(repo_root) if repo_root else None,
            dry_run=True,
            settings=settings,
        )

    report = asyncio.run(_run())
    _print_report(report)
    raise typer.Exit(code=_exit_code_for_status(report.status))


@app.command()
def rebuild(
    token: Optional[str] = typer.Option(
        None,
        "--token",
        help="CLI authentication token (defaults to KNOWLEDGE_INTERNAL_CLI_TOKEN).",
    ),
    actor: str = typer.Option(
        "knowledge-cli",
        "--actor",
        help="Actor identifier recorded on the ingestion run.",
    ),
    collection: Optional[str] = typer.Option(
        None,
        "--collection",
        help="Override the Qdrant collection name.",
    ),
) -> None:
    """Re-index all approved live knowledge versions into Qdrant.

    This is useful after a Qdrant reset or an embedding model change. It does
    not create new entry versions; it only re-generates embeddings and upserts
    the current approved corpus.
    """
    settings = _load_settings()
    resolved_token = _resolve_token(settings, token)

    asyncio.run(ensure_database_schema(settings))

    async def _run() -> object:
        from app.knowledge.ingestion.rebuild import rebuild_qdrant_index

        return await rebuild_qdrant_index(
            cli_token=resolved_token,
            actor=actor,
            collection_name=collection,
            settings=settings,
        )

    report = asyncio.run(_run())
    _print_report(report)
    raise typer.Exit(code=_exit_code_for_status(report.status))


@app.command()
def db_ready() -> None:
    """Verify PostgreSQL connectivity and knowledge table existence."""
    settings = _load_settings()
    if not settings.database_url:
        console.print(
            Panel(
                "DATABASE_URL is not configured.",
                title="Configuration error",
                border_style="red",
            )
        )
        raise typer.Exit(code=1)

    async def _check() -> None:
        await ensure_database_schema(settings)
        console.print("[green]Database is reachable.[/green]")

    try:
        asyncio.run(_check())
    except Exception as exc:
        console.print(
            Panel(
                f"Database check failed: {exc}",
                title="Database error",
                border_style="red",
            )
        )
        raise typer.Exit(code=1)


if __name__ == "__main__":
    app()
