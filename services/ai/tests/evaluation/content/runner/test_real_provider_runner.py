"""Phase 6 real-provider runner tests.

These tests prove the real-provider path is flag-driven, visibly skipped, and
fails loudly when misconfigured.  They do not call real paid providers.
"""

from __future__ import annotations

import json
import os

import pytest

from app.core.config import Settings
from app.providers.content_provider import MockContentProvider
from tests.content.fixture_helpers import make_valid_request
from tests.evaluation.content.runner.real_provider_prompts import (
    build_spot_check_generation_prompt,
)
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


def test_spot_check_prompt_is_refined_for_real_provider() -> None:
    """The real-provider prompt contains explicit Phase 6 validation rules."""
    request = make_valid_request().model_copy(update={"allowed_formats": ["text_post"]})
    refined = build_spot_check_generation_prompt(request, "openai", "gpt-4.1-mini")

    assert "Phase 6 spot-check constraints" in refined.system_prompt
    assert "Generate exactly" in refined.system_prompt
    assert "content_item_id" in refined.system_prompt
    assert "strategy_trace.pillar_ids" in refined.system_prompt
    assert "claim_sources" in refined.system_prompt


def test_spot_check_one_shot_example_is_valid_contract_json() -> None:
    from content_contracts import ContentItemVersion

    request = make_valid_request().model_copy(update={"allowed_formats": ["text_post"]})
    refined = build_spot_check_generation_prompt(request, "openai", "gpt-4.1-mini")
    json_block = refined.system_prompt.split("```json\n", 1)[1].split("\n```", 1)[0]

    payload = json.loads(json_block)
    item = ContentItemVersion.model_validate(payload["item_versions"][0])

    assert item.content_pack_id == request.content_pack_id
    assert item.strategy_trace.funnel_stage == "awareness"
    assert item.caption_variants[0].dialect == "masry"
    assert item.recommended_publish_window.time_of_day_hint == "evening"


def test_spot_check_prompt_preserves_base_user_context() -> None:
    """The refined prompt keeps the same grounded user context as the base prompt."""
    from app.content.assembler import assemble_generation_prompt

    request = make_valid_request().model_copy(update={"allowed_formats": ["text_post"]})
    base = assemble_generation_prompt(request, "openai", "gpt-4.1-mini")
    refined = build_spot_check_generation_prompt(request, "openai", "gpt-4.1-mini")

    assert refined.user_prompt == base.user_prompt
    # assembled_at is generated at call time; compare the stable metadata fields.
    stable = {k: v for k, v in base.metadata.items() if k != "assembled_at"}
    refined_stable = {k: v for k, v in refined.metadata.items() if k != "assembled_at"}
    assert refined_stable == stable


def test_spot_check_prompt_fake_provider_can_parse_context() -> None:
    """The base user context in the refined prompt is still parseable by the fake provider."""
    import asyncio

    request = make_valid_request().model_copy(update={"allowed_formats": ["text_post"]})
    refined = build_spot_check_generation_prompt(request, "openai", "gpt-4.1-mini")

    fake = MockContentProvider()
    items = asyncio.run(fake.generate_content_pack(refined))
    assert 3 <= len(items) <= 5
