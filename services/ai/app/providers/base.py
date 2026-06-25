from abc import ABC, abstractmethod
from typing import Any, Literal

from pydantic import BaseModel

from app.discovery.schemas import DiscoveryModelOutput, LanguageMode


TurnKind = Literal["start", "respond", "summarize"]


class DiscoveryProviderRequest(BaseModel):
    session_id: str
    turn_kind: TurnKind
    language_mode: LanguageMode
    payload: dict[str, Any]


class ProviderError(Exception):
    def __init__(self, code: str, message: str, retryable: bool = True) -> None:
        self.code = code
        self.retryable = retryable
        super().__init__(message)


class ProviderConfigError(ProviderError):
    def __init__(self, message: str) -> None:
        super().__init__("AI_PROVIDER_NOT_CONFIGURED", message, retryable=False)


class DiscoveryProvider(ABC):
    name: str

    @abstractmethod
    async def generate_structured(self, request: DiscoveryProviderRequest) -> DiscoveryModelOutput:
        raise NotImplementedError


def normalize_provider_output(raw_output: Any) -> DiscoveryModelOutput:
    return DiscoveryModelOutput.model_validate(raw_output)
