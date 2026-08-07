import sys
from pathlib import Path
from typing import Annotated
from uuid import uuid4

import anyio
import typer
from qdrant_client import AsyncQdrantClient

_REPO_ROOT = Path(__file__).resolve().parents[4]
_CONTRACTS_PATH = _REPO_ROOT / "packages" / "contracts" / "python"
if str(_CONTRACTS_PATH) not in sys.path:
    sys.path.append(str(_CONTRACTS_PATH))

from app.embeddings import EmbeddingConfig
from app.embeddings.fake_provider import DeterministicFakeEmbeddingProvider
from app.core.config import Settings
from app.strategy.retrieval_adapter import contract_pack_to_rag
from tests.evaluation.conftest import FIXTURES_DIR, _load_all_cases, _load_json
from tests.evaluation.dataset.schema import EvalCase
from tests.evaluation.runner.comparison_rubric import evaluate_rag_vs_norag
from tests.evaluation.runner.generation_runner import (
    GenerationEvalRunner,
    make_empty_retrieval_pack,
    make_eval_brief,
    retrieval_result_to_pack,
)
from tests.evaluation.runner.report import (
    ComparisonMetric,
    GroundingSummary,
    RetrievalEvalResult,
    build_report,
    write_report_file,
)
from tests.evaluation.runner.retrieval_runner import RetrievalEvalRunner
from tests.strategy.fixtures import default_business_profile

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
    selection_mode: Annotated[
        str,
        typer.Option(help="Retrieval selector to evaluate: semantic or semantic_mmr."),
    ] = "semantic",
) -> None:
    anyio.run(_run, suite, report_file, selection_mode)


async def _run(suite: str, report_file: Path, selection_mode: str = "semantic") -> None:
    dataset = _load_all_cases()
    match suite:
        case "smoke":
            cases = _smoke_cases(dataset.cases)
        case "full":
            cases = dataset.cases
        case _:
            raise typer.BadParameter("suite must be 'smoke' or 'full'")

    if selection_mode not in {"semantic", "semantic_mmr"}:
        raise typer.BadParameter("selection-mode must be 'semantic' or 'semantic_mmr'")

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
        runner = RetrievalEvalRunner(
            client,
            f"eval_report_{uuid4().hex}",
            provider,
            selection_mode=selection_mode,
        )
        await runner.ensure_collection()
        fixture_data = _fixture_data()
        await runner.load_fixtures(fixture_data)
        retrieval_report = await runner.run_dataset(cases, dataset_version=dataset.version)
        comparison_metrics, localization_issues = await _comparison_metrics(
            cases,
            retrieval_report.retrieval_results,
            fixture_data,
        )
        report = build_report(
            retrieval_report.retrieval_results,
            dataset_version=dataset.version,
            embedding_provider=provider.name,
            comparison_metrics=comparison_metrics,
            grounding_summary=_grounding_summary(comparison_metrics),
            localization_issues=localization_issues,
            approval_signal_source="reviewed_dataset",
            selection_mode=retrieval_report.selection_mode,
        )
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


async def _comparison_metrics(
    cases: list[EvalCase],
    retrieval_results: list[RetrievalEvalResult],
    fixture_data: list[list[dict]],
) -> tuple[list[ComparisonMetric], list[str]]:
    runner = GenerationEvalRunner(Settings(ai_provider_mode="mock"))
    profile = default_business_profile()
    metrics: list[ComparisonMetric] = []
    localization_issues: list[str] = []

    for case, result in zip(cases, retrieval_results, strict=True):
        brief = make_eval_brief(case)
        case_profile = profile.model_copy(
            update={
                "id": brief.business_profile_version.business_profile_version_id,
                "version": brief.business_profile_version.version,
            }
        )
        rag_pack = retrieval_result_to_pack(case, result, fixture_data, brief, case_profile)
        no_rag_pack = make_empty_retrieval_pack(brief, case_profile)
        pair = await runner.run_case_pair(case, profile=case_profile, pack=rag_pack)
        comparison = evaluate_rag_vs_norag(
            case_id=case.id,
            case_language=case.language,
            case_sector=case.sector,
            rag_plan=pair.rag_plan,
            rag_pack=contract_pack_to_rag(rag_pack),
            no_rag_plan=pair.no_rag_plan,
            no_rag_pack=no_rag_pack,
        )
        metrics.append(ComparisonMetric.model_validate(comparison.model_dump()))
        localization_issues.extend(_localization_issues(case.id, pair.rag_plan.model_dump_json().lower()))

    return metrics, localization_issues


def _grounding_summary(metrics: list[ComparisonMetric]) -> GroundingSummary:
    diagnostics = [diag for metric in metrics for diag in metric.rag_diagnostics]
    return GroundingSummary(
        citation_integrity_failures=sum("missing in plan.citations" in diag for diag in diagnostics),
        retrieval_resolution_failures=sum("not in retrieved_knowledge_pack" in diag for diag in diagnostics),
        benchmark_validation_failures=sum("benchmark" in diag.lower() for diag in diagnostics),
        source_enforcement_failures=sum("source governance" in diag.lower() for diag in diagnostics),
        source_reference_violations=[
            diag for diag in diagnostics if "source_reference" in diag
        ],
        ungrounded_kpis=[diag for diag in diagnostics if "KPI" in diag],
    )


def _localization_issues(case_id: str, plan_json: str) -> list[str]:
    forbidden_terms = ("arr", "annual recurring revenue", "cac payback", "linkedin-first")
    return [f"{case_id}: forbidden generic term '{term}'" for term in forbidden_terms if term in plan_json]


if __name__ == "__main__":
    app()
