from typing import Any

from pydantic import BaseModel, Field


class ErrorBody(BaseModel):
    code: str
    message: str
    request_id: str = ""
    retryable: bool
    details: dict[str, Any] = Field(default_factory=dict)


class ErrorEnvelope(BaseModel):
    error: ErrorBody


def provider_error(code: str, message: str, retryable: bool = True) -> ErrorBody:
    return ErrorBody(code=code, message=message, retryable=retryable)
