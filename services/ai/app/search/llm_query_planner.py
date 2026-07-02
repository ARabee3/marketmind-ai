import json
from json import JSONDecodeError
from typing import Any, Final, assert_never

from anyio import to_thread
from pydantic import ValidationError

from app.core.config import Settings
from app.providers.base import ProviderConfigError, ProviderError
from app.providers.openrouter_provider import OPENROUTER_BASE_URL
from app.search.query_planning_service import LlmQueryPlanner
from app.search.schemas import QueryPlan, QueryPlanningRequest

QUERY_PLAN_SYSTEM_PROMPT: Final = """
You generate web search queries for MarketMind's IntelligenceGatherer.
Return a QueryPlan JSON object only.
Rules:
- Generate useful real-world research queries for an Egyptian cafe/restaurant.
- Always include at least one competitor_discovery query when city or area exists.
- Prefer serpapi for broad web search and apify_google_maps for local competitors/reviews.
- Include owner-provided competitors and social links when present.
- Do not invent facts; only generate queries.
"""
JsonPrimitive = str | int | float | bool | None
JsonValue = JsonPrimitive | list["JsonValue"] | dict[str, "JsonValue"]


def create_llm_query_planner(settings: Settings) -> LlmQueryPlanner | None:
    match settings.ai_provider_mode:
        case "openai":
            return OpenAIQueryPlanner(
                api_key=settings.openai_api_key,
                model=settings.openai_model,
                timeout_ms=settings.ai_request_timeout_ms,
            )
        case "gemini_dev":
            return GeminiQueryPlanner(
                api_key=settings.gemini_api_key,
                model=settings.gemini_model,
                timeout_ms=settings.ai_request_timeout_ms,
            )
        case "openrouter":
            return OpenRouterQueryPlanner(
                api_key=settings.open_router_api_key,
                model=settings.open_router_model,
                timeout_ms=settings.ai_request_timeout_ms,
            )
        case "mock":
            return None
        case unreachable:
            assert_never(unreachable)


class OpenAIQueryPlanner:
    def __init__(self, api_key: str, model: str, timeout_ms: int) -> None:
        self.api_key = api_key
        self.model = model
        self.timeout_seconds = timeout_ms / 1000

    async def plan(self, request: QueryPlanningRequest) -> QueryPlan:
        if not self.api_key:
            raise ProviderConfigError("OPENAI_API_KEY is required for query planning.")
        if not self.model:
            raise ProviderConfigError("OPENAI_MODEL is required for query planning.")

        try:
            from openai import OpenAI, OpenAIError
        except ImportError as exc:
            raise ProviderConfigError("The openai package is not installed.") from exc

        def call_openai() -> QueryPlan:
            client = OpenAI(api_key=self.api_key, timeout=self.timeout_seconds)
            response = client.responses.parse(
                model=self.model,
                input=[
                    {"role": "system", "content": QUERY_PLAN_SYSTEM_PROMPT},
                    {"role": "user", "content": _query_context(request)},
                ],
                text_format=QueryPlan,
            )
            return _normalize_query_plan(response.output_parsed)

        try:
            return await to_thread.run_sync(call_openai)
        except ProviderError:
            raise
        except OpenAIError as exc:
            raise ProviderError(
                "LLM_QUERY_PLAN_FAILED",
                "OpenAI query planning failed.",
                retryable=True,
            ) from exc
        except ValidationError as exc:
            raise ProviderError(
                "LLM_QUERY_PLAN_INVALID_OUTPUT",
                "OpenAI query planning returned invalid output.",
                retryable=True,
            ) from exc


class GeminiQueryPlanner:
    def __init__(self, api_key: str, model: str, timeout_ms: int) -> None:
        self.api_key = api_key
        self.model = model
        self.timeout_ms = timeout_ms

    async def plan(self, request: QueryPlanningRequest) -> QueryPlan:
        if not self.api_key:
            raise ProviderConfigError("GEMINI_API_KEY is required for query planning.")
        if not self.model:
            raise ProviderConfigError("GEMINI_MODEL is required for query planning.")

        try:
            from google import genai
            from google.genai import errors, types
        except ImportError as exc:
            raise ProviderConfigError("The google-genai package is not installed.") from exc

        def call_gemini() -> QueryPlan:
            client = genai.Client(api_key=self.api_key)
            response = client.models.generate_content(
                model=self.model,
                contents=[_query_context(request)],
                config=types.GenerateContentConfig(
                    system_instruction=QUERY_PLAN_SYSTEM_PROMPT,
                    response_mime_type="application/json",
                    http_options=types.HttpOptions(timeout=self.timeout_ms),
                ),
            )
            return _normalize_query_plan(json.loads(response.text or "{}"))

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
            raise ProviderError(
                "LLM_QUERY_PLAN_FAILED",
                "Gemini query planning failed.",
                retryable=True,
            ) from exc
        except (JSONDecodeError, ValidationError) as exc:
            raise ProviderError(
                "LLM_QUERY_PLAN_INVALID_OUTPUT",
                "Gemini query planning returned invalid output.",
                retryable=True,
            ) from exc


class OpenRouterQueryPlanner:
    def __init__(self, api_key: str, model: str, timeout_ms: int) -> None:
        self.api_key = api_key
        self.model = model
        self.timeout_seconds = timeout_ms / 1000

    async def plan(self, request: QueryPlanningRequest) -> QueryPlan:
        if not self.api_key:
            raise ProviderConfigError("OPEN_ROUTER_API_KEY is required for query planning.")
        if not self.model:
            raise ProviderConfigError("OPEN_ROUTER_MODEL is required for query planning.")

        try:
            from openai import OpenAI, OpenAIError
        except ImportError as exc:
            raise ProviderConfigError("The openai package is not installed.") from exc

        def call_openrouter() -> QueryPlan:
            client = OpenAI(
                api_key=self.api_key,
                base_url=OPENROUTER_BASE_URL,
                timeout=self.timeout_seconds,
            )
            response = client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": QUERY_PLAN_SYSTEM_PROMPT},
                    {"role": "user", "content": _query_context(request)},
                ],
                response_format={
                    "type": "json_schema",
                    "json_schema": {
                        "name": "query_plan",
                        "strict": True,
                        "schema": QueryPlan.model_json_schema(),
                    },
                },
            )
            return _normalize_query_plan(json.loads(_message_content(response)))

        try:
            return await to_thread.run_sync(call_openrouter)
        except ProviderError:
            raise
        except OpenAIError as exc:
            raise ProviderError(
                "LLM_QUERY_PLAN_FAILED",
                "OpenRouter query planning failed.",
                retryable=True,
            ) from exc
        except (JSONDecodeError, ValidationError) as exc:
            raise ProviderError(
                "LLM_QUERY_PLAN_INVALID_OUTPUT",
                "OpenRouter query planning returned invalid output.",
                retryable=True,
            ) from exc


def _query_context(request: QueryPlanningRequest) -> str:
    return (
        "Generate 4 to 8 search queries for this discovery intake. "
        "Use the provided language mode for query text when useful.\n"
        f"{request.model_dump_json()}"
    )


def _normalize_query_plan(raw_plan: QueryPlan | JsonValue) -> QueryPlan:
    parsed = QueryPlan.model_validate(raw_plan)
    return QueryPlan(source="llm", queries=parsed.queries, warnings=parsed.warnings)


def _message_content(response: Any) -> str:
    choices = response.choices
    if not choices:
        raise ProviderError(
            "LLM_QUERY_PLAN_EMPTY_OUTPUT",
            "OpenRouter returned no query planning choices.",
            retryable=True,
        )

    content = choices[0].message.content
    if not isinstance(content, str) or not content.strip():
        raise ProviderError(
            "LLM_QUERY_PLAN_EMPTY_OUTPUT",
            "OpenRouter returned an empty query planning message.",
            retryable=True,
        )

    return content
