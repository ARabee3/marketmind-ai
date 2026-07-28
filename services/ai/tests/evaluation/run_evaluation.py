from pathlib import Path
from typing import Annotated
from uuid import uuid4

import anyio
import typer
from qdrant_client import AsyncQdrantClient

from app.embeddings import EmbeddingConfig
from app.embeddings.fake_provider import DeterministicFakeEmbeddingProvider
from tests.evaluation.conftest import FIXTURES_DIR, _load_all_cases, _load_json
from tests.evaluation.dataset.schema import EvalCase
from tests.evaluation.runner.report import write_report_file
from tests.evaluation.runner.retrieval_runner import RetrievalEvalRunner

app = typer.Typer(add_completion=False)


def _fixture_data() -> list[list[dict]]:
    return [
        _load_json(FIXTURES_DIR / "knowledge_base.json"),
        _load_json(FIXTURES_DIR / "expired_knowledge.json"),
        _load_json(FIXTURES_DIR / "unapproved_knowledge.json"),
    ]


@app.command()
def main(
    suite: Annotated[str, typer.Option(help="Evaluation suite to run: smoke or full.")] = "full",
    report_file: Annotated[
        Path,
        typer.Option(help="Path where the JSON evaluation report will be written."),
    ] = Path("evaluation_report.json"),
) -> None:
    anyio.run(_run, suite, report_file)


async def _run(suite: str, report_file: Path) -> None:
    dataset = _load_all_cases()
    match suite:
        case "smoke":
            cases = _smoke_cases(dataset.cases)
        case "full":
            cases = dataset.cases
        case _:
            raise typer.BadParameter("suite must be 'smoke' or 'full'")

    provider = DeterministicFakeEmbeddingProvider(
        EmbeddingConfig(
            provider="fake",
            model="text-embedding-3-large",
            dimensions=3072,
            batch_size=32,
        )
    )
    client = AsyncQdrantClient(location=":memory:")
    try:
        runner = RetrievalEvalRunner(client, f"eval_report_{uuid4().hex}", provider)
        await runner.ensure_collection()
        await runner.load_fixtures(_fixture_data())
        report = await runner.run_dataset(cases, dataset_version=dataset.version)
        output_path = write_report_file(report, report_file)
    finally:
        await client.close()

    typer.echo(output_path)


def _smoke_cases(cases: list[EvalCase]) -> list[EvalCase]:
    seen_sectors: set[str] = set()
    selected: list[EvalCase] = []
    for case in cases:
        if case.sector not in seen_sectors:
            selected.append(case)
            seen_sectors.add(case.sector)
    return selected


if __name__ == "__main__":
    app()
