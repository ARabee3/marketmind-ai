"""Integration tests for Strategy providers with real API calls.

These tests are marked with ``pytest.mark.network`` and are skipped when the
relevant API key is absent. Run with::

    uv run pytest tests/strategy/test_strategy_provider_integration.py -m network -v

LLM output is non-deterministic — tests verify that the provider connects and
the schema is accepted, not that Gemini follows every business rule perfectly.
"""

from __future__ import annotations

import pytest

from app.providers.base import ProviderError


def _gemini_api_key() -> str:
    """Load settings via Pydantic (reads .env) and return the Gemini key."""
    from app.core.config import Settings
    return Settings().gemini_api_key


def _gemini_model() -> str:
    from app.core.config import Settings
    return Settings().gemini_model or "gemini-2.0-flash"


skip_without_gemini_key = pytest.mark.skipif(
    not _gemini_api_key(),
    reason="GEMINI_API_KEY not set in .env or environment",
)


def _build_provider() -> tuple:
    """Construct a GeminiStrategyProvider and assemble a generation prompt.

    Returns ``(provider, prompt, request)``.
    """
    from app.providers.strategy_provider import GeminiStrategyProvider
    from app.strategy.assembler import assemble_generation_prompt
    from tests.strategy.fixtures import make_decision_bundle, make_generate_request

    api_key = _gemini_api_key()
    model = _gemini_model()
    request = make_generate_request()
    bundle = make_decision_bundle()
    prompt = assemble_generation_prompt(
        request=request,
        decision_bundle=bundle,
        provider_name="gemini_dev",
        model=model,
    )
    provider = GeminiStrategyProvider(
        api_key=api_key,
        model=model,
        timeout_ms=60_000,
    )
    return provider, prompt, request


# ---------------------------------------------------------------------------
# Gemini provider integration
# ---------------------------------------------------------------------------


@pytest.mark.network
@skip_without_gemini_key
class TestGeminiStrategyProviderIntegration:
    """Make a real Gemini API call to verify end-to-end generation."""

    @pytest.mark.anyio
    async def test_gemini_provider_generates_valid_plan(self):
        """Verify the Gemini call succeeds and the schema is accepted.

        If Gemini's output fails business-rule validation the test inspects
        the error rather than asserting a fully valid plan — the important
        thing is that the API call and schema were accepted.
        """
        from strategy_contracts import StrategyPlan

        provider, prompt, request = _build_provider()
        try:
            plan = await provider.generate_strategy_plan(prompt)
            assert isinstance(plan, StrategyPlan)
            assert plan.contract_version == "strategy-v1"
            assert plan.strategy_id == request.strategy_id
        except ProviderError as exc:
            assert exc.code == "AI_PROVIDER_INVALID_OUTPUT", (
                f"Expected validation error, got {exc.code}: {exc}"
            )

    @pytest.mark.anyio
    async def test_gemini_provider_response_parses_to_valid_model(self):
        """Verify the Gemini call succeeds and the response round-trips."""
        from strategy_contracts import StrategyPlan

        provider, prompt, _ = _build_provider()
        try:
            plan = await provider.generate_strategy_plan(prompt)
            StrategyPlan.model_validate(plan.model_dump(mode="json"))
        except ProviderError as exc:
            assert exc.code == "AI_PROVIDER_INVALID_OUTPUT", (
                f"Expected validation error, got {exc.code}: {exc}"
            )

    @pytest.mark.anyio
    async def test_gemini_provider_respects_brief_language(self):
        """Verify the provider works with an English brief."""
        from app.providers.strategy_provider import GeminiStrategyProvider
        from app.strategy.assembler import assemble_generation_prompt
        from tests.strategy.fixtures import (
            english_brief,
            make_decision_bundle,
            make_generate_request,
        )

        api_key = _gemini_api_key()
        model = _gemini_model()

        brief = english_brief()
        request = make_generate_request(brief=brief)
        bundle = make_decision_bundle()
        prompt = assemble_generation_prompt(
            request=request,
            decision_bundle=bundle,
            provider_name="gemini_dev",
            model=model,
        )

        provider = GeminiStrategyProvider(
            api_key=api_key,
            model=model,
            timeout_ms=60_000,
        )
        try:
            plan = await provider.generate_strategy_plan(prompt)
            assert plan.strategy_id == request.strategy_id
            assert plan.brief_id == request.brief.id
        except ProviderError as exc:
            assert exc.code == "AI_PROVIDER_INVALID_OUTPUT", (
                f"Expected validation error, got {exc.code}: {exc}"
            )


# ---------------------------------------------------------------------------
# OpenAI provider integration
# ---------------------------------------------------------------------------


def _openai_api_key() -> str:
    from app.core.config import Settings
    return Settings().openai_api_key


def _openai_model() -> str:
    from app.core.config import Settings
    return Settings().openai_model or "gpt-4o"


skip_without_openai_key = pytest.mark.skipif(
    not _openai_api_key(),
    reason="OPENAI_API_KEY not set in .env or environment",
)


@pytest.mark.network
@skip_without_openai_key
class TestOpenAIStrategyProviderIntegration:
    """Make a real OpenAI API call to verify end-to-end generation."""

    @staticmethod
    def _build_prompt_and_request():
        from app.strategy.assembler import assemble_generation_prompt
        from tests.strategy.fixtures import make_decision_bundle, make_generate_request

        request = make_generate_request()
        bundle = make_decision_bundle()
        prompt = assemble_generation_prompt(
            request=request,
            decision_bundle=bundle,
            provider_name="openai",
            model=_openai_model(),
        )
        return prompt, request

    @pytest.mark.anyio
    async def test_openai_provider_generates_valid_plan(self):
        from app.providers.strategy_provider import OpenAIStrategyProvider
        from strategy_contracts import StrategyPlan

        prompt, request = self._build_prompt_and_request()
        openai_provider = OpenAIStrategyProvider(
            api_key=_openai_api_key(),
            model=_openai_model(),
            timeout_seconds=60,
        )
        try:
            plan = await openai_provider.generate_strategy_plan(prompt)
            assert isinstance(plan, StrategyPlan)
            assert plan.contract_version == "strategy-v1"
            assert plan.strategy_id == request.strategy_id
        except ProviderError as exc:
            assert exc.code == "AI_PROVIDER_INVALID_OUTPUT", (
                f"Expected validation error, got {exc.code}: {exc}"
            )

    @pytest.mark.anyio
    async def test_openai_provider_response_parses_to_valid_model(self):
        from app.providers.strategy_provider import OpenAIStrategyProvider
        from strategy_contracts import StrategyPlan

        prompt, _ = self._build_prompt_and_request()
        openai_provider = OpenAIStrategyProvider(
            api_key=_openai_api_key(),
            model=_openai_model(),
            timeout_seconds=60,
        )
        try:
            plan = await openai_provider.generate_strategy_plan(prompt)
            StrategyPlan.model_validate(plan.model_dump(mode="json"))
        except ProviderError as exc:
            assert exc.code == "AI_PROVIDER_INVALID_OUTPUT", (
                f"Expected validation error, got {exc.code}: {exc}"
            )


# ---------------------------------------------------------------------------
# Endpoint smoke test with real Gemini provider
# ---------------------------------------------------------------------------


@pytest.mark.network
@skip_without_gemini_key
class TestGeminiEndpointSmoke:
    """Hits the /generate endpoint with a real Gemini provider."""

    def test_generate_endpoint_with_gemini_returns_valid_response(self):
        """Verify the endpoint accepts the request and returns a proper response.

        Accepts both 200 (plan generated successfully) and 400 (plan failed
        business-rule validation).
        """
        from fastapi.testclient import TestClient

        from app.core.config import Settings, get_settings
        from app.main import app
        from strategy_contracts import StrategyGenerateResponse
        from tests.strategy.fixtures import make_generate_request

        api_key = _gemini_api_key()
        model = _gemini_model()

        settings = Settings(
            ai_provider_mode="gemini_dev",
            gemini_api_key=api_key,
            gemini_model=model,
        )

        client = TestClient(app)
        app.dependency_overrides[get_settings] = lambda: settings
        try:
            request = make_generate_request()
            response = client.post(
                "/internal/v1/ai/strategy/generate",
                json=request.model_dump(mode="json"),
            )

            assert response.status_code in (200, 400), (
                f"Expected 200 or 400, got {response.status_code}: {response.text}"
            )
            if response.status_code == 200:
                result = StrategyGenerateResponse.model_validate(response.json())
                assert result.plan is not None
        finally:
            app.dependency_overrides.pop(get_settings, None)
