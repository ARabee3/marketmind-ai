from app.core.config import Settings
from app.providers.base import DiscoveryProvider
from app.providers.gemini_provider import GeminiDiscoveryProvider
from app.providers.mock_provider import MockDiscoveryProvider
from app.providers.openai_provider import OpenAIDiscoveryProvider


def create_provider(settings: Settings) -> DiscoveryProvider:
    if settings.ai_provider_mode == "openai":
        return OpenAIDiscoveryProvider(
            api_key=settings.openai_api_key,
            model=settings.openai_model,
            timeout_ms=settings.ai_request_timeout_ms,
        )
    if settings.ai_provider_mode == "gemini_dev":
        return GeminiDiscoveryProvider(
            api_key=settings.gemini_api_key,
            model=settings.gemini_model,
            timeout_ms=settings.ai_request_timeout_ms,
        )
    return MockDiscoveryProvider()
