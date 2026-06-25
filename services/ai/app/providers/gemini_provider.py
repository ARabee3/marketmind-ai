import json

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


class GeminiDiscoveryProvider(DiscoveryProvider):
    name = "gemini_dev"

    def __init__(self, api_key: str, model: str, timeout_ms: int) -> None:
        self.api_key = api_key
        self.model = model
        self.timeout_seconds = timeout_ms / 1000

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

            client = genai.Client(api_key=self.api_key)
            response = client.models.generate_content(
                model=self.model,
                contents=[build_user_context(request.payload)],
                config=types.GenerateContentConfig(
                    system_instruction=DISCOVERY_SYSTEM_PROMPT,
                    response_mime_type="application/json",
                    response_schema=DiscoveryModelOutput,
                    http_options=types.HttpOptions(timeout=self.timeout_seconds),
                ),
            )
            return normalize_provider_output(json.loads(response.text or "{}"))

        try:
            return await to_thread.run_sync(call_gemini)
        except ProviderError:
            raise
        except Exception as exc:
            raise ProviderError("AI_PROVIDER_FAILURE", "Gemini provider call failed.", retryable=True) from exc
