import json
from typing import Any

from anyio import to_thread

from app.discovery.prompts import DISCOVERY_SYSTEM_PROMPT, build_user_context
from app.discovery.schemas import DiscoveryModelOutput
from app.providers.base import (
    DiscoveryProvider,
    DiscoveryProviderRequest,
    ProviderConfigError,
    ProviderError,
    normalize_provider_output,
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


class GeminiDiscoveryProvider(DiscoveryProvider):
    name = "gemini_dev"

    def __init__(self, api_key: str, model: str, timeout_ms: int) -> None:
        self.api_key = api_key
        self.model = model
        self.timeout_ms = timeout_ms

    async def generate_structured(self, request: DiscoveryProviderRequest) -> DiscoveryModelOutput:
        if not self.api_key:
            raise ProviderConfigError("GEMINI_API_KEY is required for AI_PROVIDER_MODE=gemini_dev.")
        if not self.model:
            raise ProviderConfigError("GEMINI_MODEL is required for AI_PROVIDER_MODE=gemini_dev.")

        def call_gemini() -> DiscoveryModelOutput:
            try:
                from google import genai
                from google.genai import types
            except ImportError as exc:
                raise ProviderConfigError("The google-genai package is not installed.") from exc

            schema = _strip_additional_properties(DiscoveryModelOutput.model_json_schema())
            client = genai.Client(api_key=self.api_key)
            user_prompt = build_user_context(request.turn_kind, request.payload)
            response = client.models.generate_content(
                model=self.model,
                contents=[user_prompt],
                config=types.GenerateContentConfig(
                    system_instruction=DISCOVERY_SYSTEM_PROMPT,
                    response_mime_type="application/json",
                    response_schema=schema,
                    http_options=types.HttpOptions(timeout=self.timeout_ms),
                ),
            )
            return normalize_provider_output(json.loads(response.text or "{}"))

        try:
            return await to_thread.run_sync(call_gemini)
        except ProviderError:
            raise
        except Exception as exc:
            raise ProviderError(
                "AI_PROVIDER_FAILURE",
                "Gemini provider call failed.",
                retryable=True,
            ) from exc
