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


class OpenAIDiscoveryProvider(DiscoveryProvider):
    name = "openai"

    def __init__(self, api_key: str, model: str, timeout_ms: int) -> None:
        self.api_key = api_key
        self.model = model
        self.timeout_seconds = timeout_ms / 1000

    async def generate_structured(self, request: DiscoveryProviderRequest) -> DiscoveryModelOutput:
        if not self.api_key:
            raise ProviderConfigError("OPENAI_API_KEY is required for AI_PROVIDER_MODE=openai.")
        if not self.model:
            raise ProviderConfigError("OPENAI_MODEL is required for AI_PROVIDER_MODE=openai.")

        def call_openai() -> DiscoveryModelOutput:
            try:
                from openai import OpenAI
            except ImportError as exc:
                raise ProviderConfigError("The openai package is not installed.") from exc

            client = OpenAI(api_key=self.api_key, timeout=self.timeout_seconds)
            response = client.responses.parse(
                model=self.model,
                input=[
                    {"role": "system", "content": DISCOVERY_SYSTEM_PROMPT},
                    {
                        "role": "user",
                        "content": build_user_context(
                            request.turn_kind,
                            request.payload,
                        ),
                    },
                ],
                text_format=DiscoveryModelOutput,
            )
            return normalize_provider_output(response.output_parsed)

        try:
            return await to_thread.run_sync(call_openai)
        except ProviderError:
            raise
        except Exception as exc:
            raise ProviderError("AI_PROVIDER_FAILURE", "OpenAI provider call failed.", retryable=True) from exc
