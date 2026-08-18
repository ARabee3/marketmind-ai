from __future__ import annotations

from fastapi.testclient import TestClient

from app.api.internal_v1.optimization import get_optimization_provider
from app.main import create_app
from app.optimization.providers import MockOptimizationProvider
from app.providers.base import ProviderError


def _evidence(index: int, *, caption: str = "A normal caption") -> dict:
    suffix = f"{index:02d}"
    return {
        "snapshot_id": f"a1000000-0000-4000-8000-0000000000{suffix}",
        "candidate_id": f"a2000000-0000-4000-8000-0000000000{suffix}",
        "content_format": "text_post",
        "published_at": f"2026-08-{10 + index:02d}T08:00:00Z",
        "metrics": {
            "post_media_view": {"status": "available", "value": 80 + (index * 20)},
            "post_clicks": {"status": "available", "value": 8 + index},
        },
        "untrusted_caption": caption,
        "untrusted_cta": "Learn more",
    }


def _request() -> dict:
    return {
        "contract_version": "optimization-v1",
        "generation_fingerprint": "c7c2f8f7602d3e89f5be2ee0f2a277df0dd90b9ad4b6fb79f2e8f6dba6f7b1b0",
        "evidence_checksum": "b7c2f8f7602d3e89f5be2ee0f2a277df0dd90b9ad4b6fb79f2e8f6dba6f7b1b0",
        "identity": {
            "business_id": "a1000000-0000-4000-8000-000000000002",
            "strategy_id": "a1000000-0000-4000-8000-000000000011",
            "strategy_version": 2,
            "content_cycle_id": "a1000000-0000-4000-8000-000000000012",
            "format_cohort": "text_post",
        },
        "evidence": [_evidence(1), _evidence(2), _evidence(3)],
        "deterministic_comparison": [
            {
                "metric": "post_media_view",
                "baseline_median": 120,
                "values": [100, 120, 140],
                "best_snapshot_id": "a1000000-0000-4000-8000-000000000003",
                "best_value": 140,
                "delta_from_median": 20,
                "delta_percent": 16.666666666666664,
                "direction": "higher_is_better",
            },
            {
                "metric": "post_clicks",
                "baseline_median": 10,
                "values": [9, 10, 11],
                "best_snapshot_id": "a1000000-0000-4000-8000-000000000003",
                "best_value": 11,
                "delta_from_median": 1,
                "delta_percent": 10,
                "direction": "higher_is_better",
            },
        ],
        "allowed_change_kinds": ["hook_style", "cta_wording_style"],
        "prohibited_changes": [
            "strategy",
            "goal",
            "topic",
            "purpose",
            "audience",
            "channel",
            "locale",
            "format",
            "post_count",
            "media",
            "publishing_date",
            "publishing_time",
            "publishing_window",
            "offer",
            "business_facts",
            "already_created_content",
        ],
    }


def test_optimization_endpoint_returns_one_bounded_recommendation() -> None:
    app = create_app()
    app.dependency_overrides[get_optimization_provider] = lambda: MockOptimizationProvider()
    try:
        with TestClient(app) as client:
            response = client.post("/internal/v1/ai/optimization/propose", json=_request())
        assert response.status_code == 200
        body = response.json()
        assert body["outcome"] == "recommendation"
        assert body["change_kind"] in {"hook_style", "cta_wording_style"}
        assert body["evidence_snapshot_ids"] == [
            "a1000000-0000-4000-8000-000000000001",
            "a1000000-0000-4000-8000-000000000002",
            "a1000000-0000-4000-8000-000000000003",
        ]
        assert body["generation_fingerprint"] == _request()["generation_fingerprint"]
    finally:
        app.dependency_overrides.clear()


def test_optimization_endpoint_does_not_call_provider_for_insufficient_evidence() -> None:
    app = create_app()
    called = False

    class RecordingProvider(MockOptimizationProvider):
        async def generate(self, request):  # type: ignore[no-untyped-def]
            nonlocal called
            called = True
            return await super().generate(request)

    app.dependency_overrides[get_optimization_provider] = lambda: RecordingProvider()
    try:
        request = _request()
        request["evidence"] = request["evidence"][:2]
        with TestClient(app) as client:
            response = client.post("/internal/v1/ai/optimization/propose", json=request)
        assert response.status_code == 422
        assert response.json()["detail"]["error_type"] == "OPTIMIZATION_BASELINE_INSUFFICIENT"
        assert called is False
    finally:
        app.dependency_overrides.clear()


def test_optimization_endpoint_rejects_credentials_and_prompt_fields() -> None:
    request = _request()
    request["access_token"] = "never-accepted"
    app = create_app()
    try:
        with TestClient(app) as client:
            response = client.post("/internal/v1/ai/optimization/propose", json=request)
        assert response.status_code == 422
    finally:
        app.dependency_overrides.clear()


def test_optimization_provider_schema_repair_is_bounded_and_reuses_identity() -> None:
    app = create_app()
    calls: list[str] = []

    class FlakyProvider(MockOptimizationProvider):
        async def generate(self, request):  # type: ignore[no-untyped-def]
            calls.append(request.generation_fingerprint)
            if len(calls) == 1:
                raise ProviderError(
                    "OPTIMIZATION_PROVIDER_INVALID_OUTPUT",
                    "invalid once",
                    retryable=False,
                )
            return await super().generate(request)

    app.dependency_overrides[get_optimization_provider] = lambda: FlakyProvider()
    try:
        with TestClient(app) as client:
            response = client.post("/internal/v1/ai/optimization/propose", json=_request())
        assert response.status_code == 200
        assert len(calls) == 2
        assert len(set(calls)) == 1
    finally:
        app.dependency_overrides.clear()


def test_optimization_endpoint_rejects_a_changed_evidence_set() -> None:
    app = create_app()

    class WrongEvidenceProvider(MockOptimizationProvider):
        async def generate(self, request):  # type: ignore[no-untyped-def]
            result = await super().generate(request)
            result["evidence_snapshot_ids"][-1] = (
                "a1000000-0000-4000-8000-000000000099"
            )
            return result

    app.dependency_overrides[get_optimization_provider] = lambda: WrongEvidenceProvider()
    try:
        with TestClient(app) as client:
            response = client.post("/internal/v1/ai/optimization/propose", json=_request())
        assert response.status_code == 422
        assert response.json()["detail"]["error_type"] == "OPTIMIZATION_IDENTITY_CONFLICT"
    finally:
        app.dependency_overrides.clear()


def test_optimization_endpoint_rejects_tampered_deterministic_math_before_provider() -> None:
    app = create_app()
    called = False

    class RecordingProvider(MockOptimizationProvider):
        async def generate(self, request):  # type: ignore[no-untyped-def]
            nonlocal called
            called = True
            return await super().generate(request)

    app.dependency_overrides[get_optimization_provider] = lambda: RecordingProvider()
    try:
        request = _request()
        request["deterministic_comparison"][0]["baseline_median"] = 999
        with TestClient(app) as client:
            response = client.post("/internal/v1/ai/optimization/propose", json=request)
        assert response.status_code == 422
        assert called is False
    finally:
        app.dependency_overrides.clear()


def test_optimization_endpoint_bounds_repair_then_rejects_unsupported_claims() -> None:
    app = create_app()
    calls = 0

    class UnsafeClaimsProvider(MockOptimizationProvider):
        async def generate(self, request):  # type: ignore[no-untyped-def]
            nonlocal calls
            calls += 1
            result = await super().generate(request)
            result["rationale"] = (
                "This proves the hook causes higher clicks and will increase sales."
            )
            return result

    app.dependency_overrides[get_optimization_provider] = lambda: UnsafeClaimsProvider()
    try:
        with TestClient(app) as client:
            response = client.post("/internal/v1/ai/optimization/propose", json=_request())
        assert response.status_code == 422
        assert response.json()["detail"]["error_type"] == (
            "OPTIMIZATION_PROVIDER_INVALID_OUTPUT"
        )
        assert calls == 2
    finally:
        app.dependency_overrides.clear()
