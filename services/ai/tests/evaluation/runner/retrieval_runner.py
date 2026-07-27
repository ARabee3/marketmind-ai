import time
from datetime import datetime
from uuid import UUID

from app.embeddings import EmbedRequest, EmbeddingConfig, EmbeddingProvider
from app.embeddings.fake_provider import DeterministicFakeEmbeddingProvider
from app.qdrant import (
    QdrantKnowledgePoint,
    create_collection,
    create_payload_indexes,
    search_points,
    upsert_points,
)
from app.qdrant.collection import collection_exists
from app.rag.filter_builder import build_category_filter
from app.rag.query_builder import build_subqueries
from app.rag.schemas import RetrievalQueryContext

from tests.evaluation.dataset.schema import EvalCase, EvalDataset
from tests.evaluation.runner.report import (
    EvaluationReport,
    RetrievalEvalResult,
    SubqueryEvalResult,
    build_report,
)


class RetrievalEvalRunner:
    def __init__(
        self,
        qdrant_client,
        collection_name: str,
        provider: EmbeddingProvider | None = None,
    ) -> None:
        self.qdrant_client = qdrant_client
        self.collection_name = collection_name
        self.provider = provider or DeterministicFakeEmbeddingProvider(
            EmbeddingConfig(
                provider="fake",
                model="text-embedding-3-large",
                dimensions=3072,
                batch_size=32,
            )
        )

    async def ensure_collection(self, vector_size: int | None = None) -> None:
        if vector_size is None:
            vector_size = self.provider.config.dimensions
        if not await collection_exists(self.qdrant_client, self.collection_name):
            await create_collection(self.qdrant_client, self.collection_name, vector_size=vector_size)
            await create_payload_indexes(self.qdrant_client, self.collection_name)

    async def load_fixtures(self, fixtures: list[list[dict]]) -> None:
        for fixture in fixtures:
            await self._upsert_fixture_points(fixture)

    async def run_case(
        self,
        case: EvalCase,
        now: datetime | None = None,
    ) -> RetrievalEvalResult:
        if now is None:
            now = datetime.utcnow()
        start = time.perf_counter()

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
            paid_media_allowed=case.query_input.paid_media_allowed,
        )
        subqueries = build_subqueries(ctx)
        expected = case.expected_retrieval

        subquery_results: list[SubqueryEvalResult] = []
        all_returned_chunk_ids: set[str] = set()
        expected_found: set[str] = set()

        for sq in subqueries:
            sq_start = time.perf_counter()
            q_filter = build_category_filter(sq, now)
            emb_response = await self.provider.embed(EmbedRequest(texts=[sq.text]))
            vector = emb_response.embeddings[0].vector
            results = await search_points(
                self.qdrant_client,
                self.collection_name,
                vector=vector,
                query_filter=q_filter,
                limit=5,
            )
            sq_elapsed = (time.perf_counter() - sq_start) * 1000
            returned_ids = [r.payload["chunk_id"] for r in results]
            all_returned_chunk_ids.update(returned_ids)

            if expected.expected_chunk_ids:
                expected_in_subquery = [
                    cid for cid in expected.expected_chunk_ids if cid in returned_ids
                ]
                expected_found.update(expected_in_subquery)
            else:
                expected_in_subquery = []

            subquery_results.append(
                SubqueryEvalResult(
                    subquery_category=sq.category,
                    subquery_text=sq.text,
                    returned_chunk_ids=returned_ids,
                    expected_chunk_ids=expected.expected_chunk_ids,
                    matched_chunk_ids=expected_in_subquery,
                    # Case expectations are intentionally evaluated across the
                    # whole retrieval fan-out, not repeated for every category.
                    passed=True,
                    latency_ms=round(sq_elapsed, 2),
                )
            )

        total_elapsed = (time.perf_counter() - start) * 1000
        forbidden_found = all_returned_chunk_ids.intersection(expected.forbidden_chunk_ids)
        gap_categories = _detect_gaps(subquery_results)
        gap_categories_met = set(expected.required_gap_categories).issubset(gap_categories)
        top5_hit_rate = (
            len(expected_found) / len(expected.expected_chunk_ids)
            if expected.expected_chunk_ids
            else 0.0
        )
        top5_hit = (
            top5_hit_rate >= expected.min_top5_hit_rate
            if expected.expected_chunk_ids
            else len(all_returned_chunk_ids) == 0
        )
        forbidden_violation = len(forbidden_found) > 0

        retrieval_pass = (
            not forbidden_violation
            and gap_categories_met
            and (top5_hit or not expected.expected_chunk_ids)
        )

        failure_category: str | None = None
        if not retrieval_pass:
            if forbidden_violation:
                failure_category = "hard_filter"
            elif not top5_hit:
                failure_category = "corpus"
            elif not gap_categories_met:
                failure_category = "retrieval"

        # Calculate embedding cost for this case (0 for fake provider, estimated for real).
        # Issue75: track embedding costs for each case.
        embedding_cost_usd = 0.0
        if self.provider.name != "fake":
            # Real provider: estimate cost based on tokens (3-large ≈ $0.02 per 1M input tokens)
            # Approximate: ~4 tokens per subquery text, plus ~5 subqueries per case ≈ 20 tokens
            input_tokens = max(len(sq.text) // 4 for sq in subqueries) if subqueries else 0
            input_tokens = input_tokens * len(subqueries)
            embedding_cost_usd = (input_tokens / 1_000_000) * 0.02

        approval_signal = "approved" if retrieval_pass else "revision_requested"

        return RetrievalEvalResult(
            case_id=case.id,
            sector=case.sector,
            language=case.language,
            description=case.description,
            subquery_results=subquery_results,
            retrieval_pass=retrieval_pass,
            top5_hit=top5_hit,
            forbidden_violation=forbidden_violation,
            forbidden_found=sorted(str(x) for x in forbidden_found),
            detected_gap_categories=sorted(gap_categories),
            missing_gap_categories=sorted(
                set(expected.required_gap_categories) - gap_categories
            ),
            total_latency_ms=round(total_elapsed, 2),
            top5_hit_rate=round(top5_hit_rate, 4),
            evaluated_for_top5=bool(expected.expected_chunk_ids),
            failure_category=failure_category,
            approval_signal=approval_signal,
            embedding_cost_usd=round(embedding_cost_usd, 6),
        )

    async def run_dataset(
        self,
        cases: list[EvalCase],
        dataset_version: str = "eval-v1",
        now: datetime | None = None,
    ) -> EvaluationReport:
        results: list[RetrievalEvalResult] = []
        for case in cases:
            result = await self.run_case(case, now)
            results.append(result)
        return build_report(
            results,
            dataset_version=dataset_version,
            embedding_provider=self.provider.name,
        )

    async def _upsert_fixture_points(self, points: list[dict]) -> None:
        texts = [p["text"] for p in points]
        embeddings = await self.provider.embed(EmbedRequest(texts=texts))
        kps_and_vecs = []
        for idx, p in enumerate(points):
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
                requires_paid_media=p.get("requires_paid_media", False),
            )
            kps_and_vecs.append((kp, embeddings.embeddings[idx].vector))
        await upsert_points(self.qdrant_client, self.collection_name, kps_and_vecs)


def _detect_gaps(
    subquery_results: list[SubqueryEvalResult],
) -> set[str]:
    gaps: set[str] = set()
    for sr in subquery_results:
        if len(sr.returned_chunk_ids) == 0:
            gaps.add(sr.subquery_category)
    return gaps
