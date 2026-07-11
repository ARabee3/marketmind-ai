import json
from json import JSONDecodeError
from typing import Any, Final

from anyio import to_thread
from pydantic import ValidationError

from app.discovery.prompts import DISCOVERY_SYSTEM_PROMPT, build_user_context
from app.discovery.question_language import question_matches_language
from app.discovery.schemas import DiscoveryModelOutput, LanguageMode
from app.providers.base import (
    DiscoveryProvider,
    DiscoveryProviderRequest,
    ProviderConfigError,
    ProviderError,
    normalize_provider_output,
)


OPENROUTER_BASE_URL: Final = "https://openrouter.ai/api/v1"
DISCOVERY_ATTEMPT_TIMEOUT_RATIO: Final = 0.45
QUESTION_ACTIONS: Final = {"ask_next_question", "ask_clarification"}
QUESTION_REPAIR_MESSAGE: Final = (
    "Repair the previous Discovery response. Return valid JSON for the schema. "
    "If action is ask_next_question or ask_clarification, next_question is required "
    "and must match the requested language_mode."
)


class OpenRouterDiscoveryProvider(DiscoveryProvider):
    name = "openrouter"

    def __init__(self, api_key: str, model: str, timeout_ms: int) -> None:
        self.api_key = api_key
        self.model = model
        self.timeout_seconds = timeout_ms * DISCOVERY_ATTEMPT_TIMEOUT_RATIO / 1000

    async def generate_structured(self, request: DiscoveryProviderRequest) -> DiscoveryModelOutput:
        if not self.api_key:
            raise ProviderConfigError(
                "OPEN_ROUTER_API_KEY is required for AI_PROVIDER_MODE=openrouter."
            )
        if not self.model:
            raise ProviderConfigError(
                "OPEN_ROUTER_MODEL is required for AI_PROVIDER_MODE=openrouter."
            )

        def call_openrouter() -> DiscoveryModelOutput:
            try:
                from openai import OpenAI, OpenAIError
            except ImportError as exc:
                raise ProviderConfigError("The openai package is not installed.") from exc

            client = OpenAI(
                api_key=self.api_key,
                base_url=OPENROUTER_BASE_URL,
                timeout=self.timeout_seconds,
                max_retries=0,
            )

            base_messages = [
                {"role": "system", "content": DISCOVERY_SYSTEM_PROMPT},
                {
                    "role": "user",
                    "content": build_user_context(
                        request.turn_kind,
                        request.payload,
                    ),
                },
            ]

            last_invalid: ProviderError | None = None
            for attempt in range(2):
                messages = base_messages
                if attempt == 1:
                    messages = [
                        *base_messages,
                        {"role": "user", "content": QUESTION_REPAIR_MESSAGE},
                    ]
                try:
                    response = client.chat.completions.create(
                        model=self.model,
                        messages=messages,
                        response_format=_json_schema_response_format(
                            "discovery_model_output",
                            DiscoveryModelOutput.model_json_schema(),
                        ),
                    )
                    return _normalize_openrouter_output(
                        _message_content(response),
                        request.language_mode,
                    )
                except OpenAIError as exc:
                    raise ProviderError(
                        "AI_PROVIDER_FAILURE",
                        "OpenRouter provider call failed.",
                        retryable=True,
                    ) from exc
                except (JSONDecodeError, ValidationError) as exc:
                    last_invalid = ProviderError(
                        "AI_PROVIDER_INVALID_OUTPUT",
                        "OpenRouter returned invalid Discovery JSON.",
                        retryable=True,
                    )
                    last_invalid.__cause__ = exc
                except ProviderError as exc:
                    if exc.code != "AI_PROVIDER_INVALID_OUTPUT":
                        raise
                    last_invalid = exc

            if last_invalid is not None:
                raise last_invalid
            raise ProviderError(
                "AI_PROVIDER_INVALID_OUTPUT",
                "OpenRouter returned invalid Discovery JSON.",
                retryable=True,
            )

        try:
            return await to_thread.run_sync(call_openrouter, abandon_on_cancel=True)
        except ProviderError:
            raise


def _json_schema_response_format(name: str, schema: dict[str, Any]) -> dict[str, Any]:
    return {
        "type": "json_schema",
        "json_schema": {
            "name": name,
            "strict": True,
            "schema": schema,
        },
    }


def _message_content(response: Any) -> str:
    if not response.choices:
        raise ProviderError(
            "AI_PROVIDER_EMPTY_OUTPUT",
            "OpenRouter returned no choices.",
            retryable=True,
        )

    content = response.choices[0].message.content
    if not isinstance(content, str) or not content.strip():
        raise ProviderError(
            "AI_PROVIDER_EMPTY_OUTPUT",
            "OpenRouter returned an empty message.",
            retryable=True,
        )

    return content


def _normalize_openrouter_output(
    content: str,
    language_mode: LanguageMode,
) -> DiscoveryModelOutput:
    raw_output = json.loads(content)
    if isinstance(raw_output, dict) and raw_output.get("action") in QUESTION_ACTIONS:
        next_question = raw_output.get("next_question")
        if (
            not isinstance(next_question, str)
            or not next_question.strip()
            or not question_matches_language(
            next_question,
            language_mode,
            )
        ):
            raise ProviderError(
                "AI_PROVIDER_INVALID_OUTPUT",
                "OpenRouter returned a Discovery question in the wrong language.",
                retryable=True,
            )

    return normalize_provider_output(raw_output)
