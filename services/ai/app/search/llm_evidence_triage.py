import json
from json import JSONDecodeError
from typing import Any, Final, assert_never

from anyio import to_thread
from pydantic import ValidationError

from app.core.config import Settings
from app.providers.base import ProviderConfigError, ProviderError
from app.providers.openrouter_provider import OPENROUTER_BASE_URL
from app.search.evidence_triage_service import EvidenceTriagePlanner
from app.search.schemas import (
    EvidenceTriageCandidate,
    EvidenceTriageDecision,
    EvidenceTriageRequest,
    EvidenceTriageResult,
)

def _strip_additional_properties(schema: dict[str, Any]) -> dict[str, Any]:
    schema.pop("additionalProperties", None)
    for value in schema.values():
        if isinstance(value, dict):
            _strip_additional_properties(value)
        elif isinstance(value, list):
            for item in value:
                if isinstance(item, dict):
                    _strip_additional_properties(item)
    return schema


TRIAGE_SYSTEM_PROMPT: Final = """
You classify MarketMind IntelligenceGatherer search evidence.
Return an EvidenceTriageResult JSON object only.
Rules:
- You are the sole evidence triage decision maker.
- Judge whether each candidate is the owner's business, a competitor, market context,
  social signal, directory/listicle, or irrelevant.
- Use Egyptian local-business context and Arabic wording carefully.
- Use needs_confirmation for plausible but unverified data the owner should confirm.
- Do not turn unconfirmed search evidence into confirmed owner facts.
- Return one decision for every candidate index.
- For each candidate, include a `synthesized_observation` field with a single sentence
  in the business's language (use the language_mode from the request) summarizing the
  key evidence finding. Example: "قصر نابولي has 8 branches in Assiut, operates since
  2000, and delivers via Talabat with a 4.3★ rating from 1500+ reviews."
  If the candidate is discarded or has no useful information, set it to null.
"""


def create_evidence_triage_planner(settings: Settings) -> EvidenceTriagePlanner:
    match settings.ai_provider_mode:
        case "mock":
            return MockEvidenceTriagePlanner()
        case "openai":
            return OpenAIEvidenceTriagePlanner(
                api_key=settings.openai_api_key,
                model=settings.openai_model,
                timeout_ms=settings.discovery_triage_timeout_ms,
            )
        case "gemini_dev":
            return GeminiEvidenceTriagePlanner(
                api_key=settings.gemini_api_key,
                model=settings.gemini_model,
                timeout_ms=settings.discovery_triage_timeout_ms,
            )
        case "openrouter":
            return OpenRouterEvidenceTriagePlanner(
                api_key=settings.open_router_api_key,
                model=settings.open_router_model,
                timeout_ms=settings.discovery_triage_timeout_ms,
            )
        case unreachable:
            assert_never(unreachable)


class MockEvidenceTriagePlanner:
    async def triage(self, request: EvidenceTriageRequest) -> EvidenceTriageResult:
        return EvidenceTriageResult(
            source="llm",
            decisions=[_mock_decision(candidate) for candidate in request.candidates],
        )


class OpenAIEvidenceTriagePlanner:
    def __init__(self, api_key: str, model: str, timeout_ms: int) -> None:
        self.api_key = api_key
        self.model = model
        self.timeout_seconds = timeout_ms / 1000

    async def triage(self, request: EvidenceTriageRequest) -> EvidenceTriageResult:
        if not self.api_key:
            raise ProviderConfigError("OPENAI_API_KEY is required for evidence triage.")
        if not self.model:
            raise ProviderConfigError("OPENAI_MODEL is required for evidence triage.")

        try:
            from openai import OpenAI, OpenAIError
        except ImportError as exc:
            raise ProviderConfigError("The openai package is not installed.") from exc

        def call_openai() -> EvidenceTriageResult:
            client = OpenAI(api_key=self.api_key, timeout=self.timeout_seconds)
            response = client.responses.parse(
                model=self.model,
                input=[
                    {"role": "system", "content": TRIAGE_SYSTEM_PROMPT},
                    {"role": "user", "content": _triage_context(request)},
                ],
                text_format=EvidenceTriageResult,
            )
            return _normalize_triage(response.output_parsed)

        try:
            return await to_thread.run_sync(call_openai)
        except ProviderError:
            raise
        except OpenAIError as exc:
            raise ProviderError("LLM_TRIAGE_FAILED", "OpenAI evidence triage failed.") from exc
        except ValidationError as exc:
            raise ProviderError(
                "LLM_TRIAGE_INVALID_OUTPUT",
                "OpenAI evidence triage returned invalid output.",
            ) from exc


class GeminiEvidenceTriagePlanner:
    def __init__(self, api_key: str, model: str, timeout_ms: int) -> None:
        self.api_key = api_key
        self.model = model
        self.timeout_ms = timeout_ms

    async def triage(self, request: EvidenceTriageRequest) -> EvidenceTriageResult:
        if not self.api_key:
            raise ProviderConfigError("GEMINI_API_KEY is required for evidence triage.")
        if not self.model:
            raise ProviderConfigError("GEMINI_MODEL is required for evidence triage.")

        try:
            from google import genai
            from google.genai import errors, types
        except ImportError as exc:
            raise ProviderConfigError("The google-genai package is not installed.") from exc

        def call_gemini() -> EvidenceTriageResult:
            client = genai.Client(api_key=self.api_key)
            triage_schema = _strip_additional_properties(
                EvidenceTriageResult.model_json_schema(),
            )
            response = client.models.generate_content(
                model=self.model,
                contents=[_triage_context(request)],
                config=types.GenerateContentConfig(
                    system_instruction=TRIAGE_SYSTEM_PROMPT,
                    response_mime_type="application/json",
                    response_schema=triage_schema,
                    http_options=types.HttpOptions(timeout=self.timeout_ms),
                ),
            )
            return _normalize_triage(json.loads(response.text or "{}"))

        try:
            return await to_thread.run_sync(call_gemini)
        except ProviderError:
            raise
        except (
            errors.APIError,
            errors.ClientError,
            errors.ServerError,
            errors.UnknownApiResponseError,
        ) as exc:
            raise ProviderError("LLM_TRIAGE_FAILED", "Gemini evidence triage failed.") from exc
        except (JSONDecodeError, ValidationError) as exc:
            raise ProviderError(
                "LLM_TRIAGE_INVALID_OUTPUT",
                "Gemini evidence triage returned invalid output.",
            ) from exc


class OpenRouterEvidenceTriagePlanner(OpenAIEvidenceTriagePlanner):
    async def triage(self, request: EvidenceTriageRequest) -> EvidenceTriageResult:
        if not self.api_key:
            raise ProviderConfigError("OPEN_ROUTER_API_KEY is required for evidence triage.")
        if not self.model:
            raise ProviderConfigError("OPEN_ROUTER_MODEL is required for evidence triage.")

        try:
            from openai import OpenAI, OpenAIError
        except ImportError as exc:
            raise ProviderConfigError("The openai package is not installed.") from exc

        def call_openrouter() -> EvidenceTriageResult:
            client = OpenAI(
                api_key=self.api_key,
                base_url=OPENROUTER_BASE_URL,
                timeout=self.timeout_seconds,
            )
            response = client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": TRIAGE_SYSTEM_PROMPT},
                    {"role": "user", "content": _triage_context(request)},
                ],
                response_format={
                    "type": "json_schema",
                    "json_schema": {
                        "name": "evidence_triage",
                        "strict": True,
                        "schema": EvidenceTriageResult.model_json_schema(),
                    },
                },
            )
            return _normalize_triage(json.loads(_message_content(response)))

        try:
            return await to_thread.run_sync(call_openrouter)
        except ProviderError:
            raise
        except OpenAIError as exc:
            raise ProviderError("LLM_TRIAGE_FAILED", "OpenRouter evidence triage failed.") from exc
        except (JSONDecodeError, ValidationError) as exc:
            raise ProviderError(
                "LLM_TRIAGE_INVALID_OUTPUT",
                "OpenRouter evidence triage returned invalid output.",
            ) from exc


def _mock_decision(candidate: EvidenceTriageCandidate) -> EvidenceTriageDecision:
    match candidate.intent:
        case "competitor_discovery":
            classification = "competitor"
            tier = "confirmed_signal"
        case "social_profile":
            classification = "social_signal"
            tier = "needs_confirmation"
        case "market_context" | "review_presence" | "business_match":
            classification = "market_context"
            tier = "confirmed_signal" if candidate.provider_confidence >= 0.45 else "discarded"
        case unreachable:
            assert_never(unreachable)

    snippet = candidate.snippet or candidate.title or ""
    return EvidenceTriageDecision(
        index=candidate.index,
        classification=classification,
        evidence_tier=tier,
        confidence=candidate.provider_confidence,
        reason=snippet or "Evidence candidate reviewed.",
        suggested_owner_question=None if tier == "confirmed_signal" else "Is this finding accurate?",
        synthesized_observation=snippet[:200] if snippet else None,
    )


def _triage_context(request: EvidenceTriageRequest) -> str:
    return (
        f"language_mode: {request.language_mode}\n"
        "Classify every candidate. Return one decision per candidate index.\n"
        f"{request.model_dump_json()}"
    )


def _normalize_triage(raw_result: EvidenceTriageResult | dict[str, Any]) -> EvidenceTriageResult:
    result = EvidenceTriageResult.model_validate(raw_result)
    return EvidenceTriageResult(source="llm", decisions=result.decisions, warnings=result.warnings)


def _message_content(response: Any) -> str:
    choices = response.choices
    if not choices:
        raise ProviderError("LLM_TRIAGE_EMPTY_OUTPUT", "OpenRouter returned no triage choices.")

    content = choices[0].message.content
    if not isinstance(content, str) or not content.strip():
        raise ProviderError("LLM_TRIAGE_EMPTY_OUTPUT", "OpenRouter returned empty triage output.")

    return content
