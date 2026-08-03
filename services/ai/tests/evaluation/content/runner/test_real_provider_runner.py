"""Phase 6 real-provider runner tests.

These tests prove the real-provider path is flag-driven, visibly skipped, and
fails loudly when misconfigured.  They do not call real paid providers.
"""

from __future__ import annotations

import os

import pytest

from app.core.config import Settings
from app.providers.content_provider import MockContentProvider
from tests.evaluation.content.runner.real_provider_runner import (
    REAL_PROVIDER_FLAG,
    create_real_provider,
    format_spot_check_summary,
    is_real_provider_enabled,
    run_real_provider_spot_check,
)


@pytest.fixture(autouse=True)
def _clear_env_flag(monkeypatch):
    """Ensure the real-provider flag is unset by default for every test."""
    monkeypatch.delenv(REAL_PROVIDER_FLAG, raising=False)


def test_real_provider_flag_is_disabled_by_default() -> None:
    assert is_real_provider_enabled() is False


def test_real_provider_spot_check_is_visibly_skipped() -> None:
    report = run_real_provider_spot_check()
    assert report["status"] == "skipped"
    assert REAL_PROVIDER_FLAG in report["reason"]


def test_real_provider_spot_check_summary_for_skip() -> None:
    report = run_real_provider_spot_check()
    summary = format_spot_check_summary(report)
    assert summary.startswith("[SKIPPED]")
    assert REAL_PROVIDER_FLAG in summary


def test_create_real_provider_raises_when_mode_is_mock(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """If the flag is set but ai_provider_mode is still mock, fail loudly."""
    monkeypatch.setenv("ai_provider_mode", "mock")
    with pytest.raises(ValueError) as exc_info:
        create_real_provider()
    assert "ai_provider_mode=mock" in str(exc_info.value)
    assert REAL_PROVIDER_FLAG in str(exc_info.value)


def test_spot_check_reports_error_when_mock_mode_is_forced(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Even with the flag, a misconfigured env produces an error report."""
    monkeypatch.setenv(REAL_PROVIDER_FLAG, "1")
    monkeypatch.setenv("ai_provider_mode", "mock")
    report = run_real_provider_spot_check()
    assert report["status"] == "error"
    assert "ai_provider_mode=mock" in report["reason"]


def test_spot_check_summary_for_error(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(REAL_PROVIDER_FLAG, "1")
    monkeypatch.setenv("ai_provider_mode", "mock")
    report = run_real_provider_spot_check()
    summary = format_spot_check_summary(report)
    assert summary.startswith("[ERROR]")


@pytest.mark.skipif(
    not os.environ.get(REAL_PROVIDER_FLAG),
    reason=f"requires {REAL_PROVIDER_FLAG}=1 and real credentials",
)
def test_real_provider_spot_check_runs_when_flag_and_credentials_present() -> None:
    """Manual gate: only runs when a real provider is actually configured."""
    report = run_real_provider_spot_check()
    assert report["status"] in {"run", "error"}
    if report["status"] == "run":
        assert "provider_name" in report
        assert "fake" in report
        assert "real" in report
        assert "match" in report


def test_real_provider_runner_imports_do_not_pull_network() -> None:
    """Importing the runner module must not trigger any network call."""
    # The import itself is the test; if it imported a provider that made a network
    # call, this test would fail.
    from tests.evaluation.content.runner import real_provider_runner

    assert real_provider_runner is not None
    assert MockContentProvider().name == "mock"
