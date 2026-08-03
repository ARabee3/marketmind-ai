"""Phase 6 real-provider comparison runner.

Flag-driven, manual-only path.  When ``MARKETMIND_CONTENT_REAL_PROVIDER=1`` is set,
this runner creates a real ``ContentLLMProvider`` from environment credentials,
spot-checks it against the same representative request that the fake provider
uses, and compares the contract validation results.  When the flag is unset the
run is **visibly skipped** and never silent.

This path never runs in CI; it is a human sanity-check that the real provider
still satisfies the deterministic contract validator.
"""

from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path
from typing import Any

# When this module is run directly (python -m ...), ensure the frozen contract
# package is on sys.path.  pytest.ini does this automatically for tests.
if __name__ == "__main__":
    _repo_root = Path(__file__).resolve().parents[6]
    _contracts_path = _repo_root / "packages" / "contracts" / "python"
    if str(_contracts_path) not in sys.path:
        sys.path.insert(0, str(_contracts_path))

from app.content.assembler import PromptAssembly, assemble_generation_prompt
from app.content.validators import (
    compute_content_item_checksum,
    validate_generated_content_pack,
)
from content_contracts import ContentItemVersion
from app.core.config import ProviderMode, Settings
from app.providers.content_provider import (
    ContentLLMProvider,
    MockContentProvider,
    create_content_provider,
)
from tests.content.fixture_helpers import make_valid_request
from tests.evaluation.content.runner.real_provider_prompts import (
    build_spot_check_generation_prompt,
)


REAL_PROVIDER_FLAG = "MARKETMIND_CONTENT_REAL_PROVIDER"


def is_real_provider_enabled() -> bool:
    """Return True when the manual real-provider spot-check is requested."""
    return os.environ.get(REAL_PROVIDER_FLAG) == "1"


def _real_provider_settings() -> Settings:
    """Build Settings from environment variables for the real provider.

    Requires one of the real provider modes to be configured via env vars:
    ``ai_provider_mode`` (openai/gemini_dev/openrouter) plus the matching API key
    and model.  If the mode is still ``mock`` despite the flag, this raises a
    clear error so the run is never accidentally silent.
    """
    settings = Settings()
    if settings.ai_provider_mode == "mock":
        raise ValueError(
            f"{REAL_PROVIDER_FLAG}=1 but ai_provider_mode=mock. "
            "Set ai_provider_mode to openai, gemini_dev, or openrouter, "
            "and provide the matching API key and model."
        )
    return settings


def create_real_provider() -> ContentLLMProvider:
    """Create a real ContentLLMProvider from environment credentials."""
    settings = _real_provider_settings()
    return create_content_provider(settings)


def _provider_model(provider: ContentLLMProvider, settings: Settings) -> str:
    """Return the model name to use for the provider."""
    if settings.ai_provider_mode == "openai":
        return settings.openai_model or "gpt-4.1-mini"
    if settings.ai_provider_mode == "gemini_dev":
        return settings.gemini_model or "gemini-1.5-flash"
    if settings.ai_provider_mode == "openrouter":
        return settings.open_router_model or "openai/gpt-4o-mini"
    return "unknown"


def _validation_summary(result: Any) -> dict[str, Any]:
    """Flatten a ContentValidationResult into a JSON-safe dict."""
    return {
        "valid": result.valid,
        "issue_codes": sorted({issue.code for issue in result.issues}),
        "issue_count": len(result.issues),
        "issues": [
            {
                "code": issue.code,
                "field": issue.field,
                "message": issue.message,
            }
            for issue in result.issues
        ],
    }


async def _generate(provider: ContentLLMProvider, prompt: Any) -> list[Any]:
    """Async wrapper for the provider's generate_content_pack."""
    return await provider.generate_content_pack(prompt)


def _finalize_item_checksums(items: list[ContentItemVersion]) -> list[ContentItemVersion]:
    """Recompute server-side checksums exactly as the production service does.

    Real providers cannot know the exact immutable-byte serialization, so the
    production pipeline always recomputes `version_checksum` server-side. Doing
    the same here keeps the spot-check focused on content correctness rather
    than checksum prediction.
    """
    finalized: list[ContentItemVersion] = []
    for item in items:
        without_checksum = item.model_copy(update={"version_checksum": ""})
        finalized.append(
            without_checksum.model_copy(
                update={"version_checksum": compute_content_item_checksum(without_checksum)}
            )
        )
    return finalized


async def _run_spot_check() -> dict[str, Any]:
    """Run the real provider against the representative request and compare."""
    settings = _real_provider_settings()
    provider = create_real_provider()
    fake_provider = MockContentProvider()

    request = make_valid_request().model_copy(update={"allowed_formats": ["text_post"]})
    model = _provider_model(provider, settings)
    # The fake baseline keeps the standard prompt; the real provider gets a
    # spot-check-specific prompt with explicit contract-validation constraints.
    fake_prompt = assemble_generation_prompt(request, provider.name, model)
    real_prompt = build_spot_check_generation_prompt(request, provider.name, model)

    fake_items, real_items = await asyncio.gather(
        _generate(fake_provider, fake_prompt),
        _generate(provider, real_prompt),
    )

    # Recompute server-side checksums so the comparison tests content quality,
    # not the provider's ability to predict immutable-byte checksums.
    fake_items = _finalize_item_checksums(fake_items)
    real_items = _finalize_item_checksums(real_items)

    fake_result = validate_generated_content_pack(request, fake_items)
    real_result = validate_generated_content_pack(request, real_items)

    return {
        "status": "run",
        "provider_name": provider.name,
        "model": model,
        "fake": _validation_summary(fake_result),
        "real": _validation_summary(real_result),
        "match": fake_result.valid == real_result.valid,
        "item_counts": {
            "fake": len(fake_items),
            "real": len(real_items),
        },
    }


def run_real_provider_spot_check() -> dict[str, Any]:
    """Entry point for the Phase 6 real-provider comparison.

    Returns a JSON-safe report.  When the flag is unset the report is visibly
    skipped; when set it runs the real provider and compares validation results.
    """
    if not is_real_provider_enabled():
        return {
            "status": "skipped",
            "reason": (
                f"{REAL_PROVIDER_FLAG} is not set to 1. "
                "Set it to enable the manual real-provider spot-check."
            ),
        }

    try:
        return asyncio.run(_run_spot_check())
    except Exception as exc:
        reason = f"Real provider spot-check failed: {exc}"
        # Surface the underlying provider/network error for easier diagnosis.
        cause = exc.__cause__
        if cause is not None:
            reason += f" (caused by {cause.__class__.__name__}: {cause})"
        return {
            "status": "error",
            "reason": reason,
        }


def format_spot_check_summary(report: dict[str, Any]) -> str:
    """Human-readable summary of a spot-check report."""
    status = report.get("status")
    if status == "skipped":
        return f"[SKIPPED] {report.get('reason')}"
    if status == "error":
        return f"[ERROR] {report.get('reason')}"
    if status == "run":
        lines = [
            "[RUN] Real provider spot-check",
            f"Provider: {report.get('provider_name')} ({report.get('model')})",
            f"Fake items: {report['item_counts']['fake']}",
            f"Real items: {report['item_counts']['real']}",
            f"Fake valid: {report['fake']['valid']} ({report['fake']['issue_count']} issues)",
            f"Real valid: {report['real']['valid']} ({report['real']['issue_count']} issues)",
            f"Match: {report['match']}",
        ]
        if not report["fake"]["valid"]:
            fake_codes = ", ".join(report["fake"]["issue_codes"]) or "none"
            lines.append(f"Fake issue codes: {fake_codes}")
            for issue in report["fake"].get("issues", []):
                lines.append(
                    f"    - {issue['code']} ({issue['field']}): {issue['message']}"
                )
        if not report["real"]["valid"]:
            real_codes = ", ".join(report["real"]["issue_codes"]) or "none"
            lines.append(f"Real issue codes: {real_codes}")
            for issue in report["real"].get("issues", []):
                lines.append(
                    f"    - {issue['code']} ({issue['field']}): {issue['message']}"
                )
        return "\n".join(lines)
    return f"[UNKNOWN] {report}"


if __name__ == "__main__":
    # Manual entry point (run from services/ai with packages/contracts/python on
    # PYTHONPATH, e.g. via uv run):
    #   cd services/ai
    #   uv run python -m tests.evaluation.content.runner.real_provider_runner
    print(format_spot_check_summary(run_real_provider_spot_check()))
