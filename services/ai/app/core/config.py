from functools import lru_cache
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


ProviderMode = Literal["mock", "openai", "gemini_dev"]


class Settings(BaseSettings):
    ai_provider_mode: ProviderMode = "mock"
    ai_request_timeout_ms: int = Field(default=30_000, ge=1_000, le=120_000)
    openai_api_key: str = ""
    openai_model: str = ""
    gemini_api_key: str = ""
    gemini_model: str = ""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


@lru_cache
def get_settings() -> Settings:
    return Settings()
