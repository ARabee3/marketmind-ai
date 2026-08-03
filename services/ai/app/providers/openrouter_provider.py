import json
from json import JSONDecodeError
from typing import Any, Final

from anyio import to_thread
from pydantic import ValidationError

from app.discovery.prompts import DISCOVERY_SYSTEM_PROMPT, build_user_context
from app.discovery.schemas import DiscoveryModelOutput
from app.providers.base import (
    DiscoveryProvider,
    DiscoveryProviderRequest,
    ProviderConfigError,
    ProviderError,
    normalize_provider_output,
)


OPENROUTER_BASE_URL: Final = "https://openrouter.ai/api/v1"
DISCOVERY_ATTEMPT_TIMEOUT_RATIO: Final = 0.45


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

            messages = [
                {"role": "system", "content": DISCOVERY_SYSTEM_PROMPT},
                {
                    "role": "user",
                    "content": build_user_context(
                        request.turn_kind,
                        request.payload,
                    ),
                },
            ]
            if request.repair_hint:
                messages.append({"role": "user", "content": request.repair_hint})

            try:
                response = client.chat.completions.create(
                    model=self.model,
                    messages=messages,
                    response_format=_json_schema_response_format(
                        "discovery_model_output",
                        DiscoveryModelOutput.model_json_schema(),
                    ),
                )
                return _normalize_openrouter_output(_message_content(response))
            except OpenAIError as exc:
                raise ProviderError(
                    "AI_PROVIDER_FAILURE",
                    "OpenRouter provider call failed.",
                    retryable=True,
                ) from exc
            except (JSONDecodeError, ValidationError) as exc:
                raise ProviderError(
                    "AI_PROVIDER_INVALID_OUTPUT",
                    "OpenRouter returned invalid Discovery JSON.",
                    retryable=False,
                ) from exc
            except ProviderError as exc:
                raise

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


def _normalize_openrouter_output(content: str) -> DiscoveryModelOutput:
    return normalize_provider_output(json.loads(content))
