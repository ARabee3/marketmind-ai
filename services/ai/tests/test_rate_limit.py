"""In-memory rate limiting for the AI service HTTP boundary."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.core import config
from app.main import create_app


def _app_with_limit(limit: int) -> TestClient:
    return TestClient(create_app(rate_limit_per_minute=limit))


def test_requests_below_limit_succeed() -> None:
    client = _app_with_limit(5)

    for _ in range(5):
        response = client.get("/health")
        assert response.status_code == 200


def test_requests_over_limit_return_429() -> None:
    client = _app_with_limit(2)

    assert client.get("/health").status_code == 200
    assert client.get("/health").status_code == 200
    assert client.get("/health").status_code == 429


def test_zero_limit_disables_limiting() -> None:
    client = _app_with_limit(0)

    for _ in range(10):
        assert client.get("/health").status_code == 200


def test_app_wiring_reads_rate_limit_from_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AI_RATE_LIMIT_PER_MINUTE", "2")
    config.get_settings.cache_clear()

    client = TestClient(create_app())

    assert client.get("/health").status_code == 200
    assert client.get("/health").status_code == 200
    assert client.get("/health").status_code == 429
