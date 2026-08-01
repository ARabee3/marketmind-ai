"""Bounded Content provider retry and structured-output repair orchestration."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from typing import Any

from content_contracts import ContentItemVersion

from app.content.assembler import PromptAssembly
from app.providers.base import ProviderError
from app.providers.content_provider import ContentLLMProvider
from app.content.validators import validate_revision_item


MAX_CONTENT_ATTEMPTS = 3
_SCHEMA_ERROR_CODES = {
    "CONTENT_SCHEMA_FAILURE",
    "AI_PROVIDER_INVALID_OUTPUT",
}


def _repair_prompt(prompt: PromptAssembly, error: ProviderError, attempt: int) -> PromptAssembly:
    return PromptAssembly(
        system_prompt=(
            f"{prompt.system_prompt}\n\n"
            "STRUCTURED OUTPUT REPAIR: The previous response failed deterministic "
            "content-v1 validation. Regenerate the complete requested output. "
            "Do not return a patch, explanation, approval, or publishing decision."
        ),
        user_prompt=(
            f"{prompt.user_prompt}\n\n"
            "The previous output failed with this safe validation summary:\n"
            f"code={error.code}\nmessage={str(error)}\n"
            "Return the complete corrected structured output."
        ),
        metadata={
            **prompt.metadata,
            "repair_attempt": attempt,
            "repair_error_code": error.code,
        },
    )


def _validate_pack_shape(items: list[ContentItemVersion]) -> None:
    if not 3 <= len(items) <= 5:
        raise ProviderError(
            "CONTENT_SCHEMA_FAILURE",
            "Content generation must return between 3 and 5 item versions.",
            retryable=False,
        )
    if len({item.id for item in items}) != len(items):
        raise ProviderError(
            "CONTENT_SCHEMA_FAILURE",
            "Content generation returned duplicate item-version identities.",
            retryable=False,
        )


async def generate_content_pack_with_repair(
    provider: ContentLLMProvider,
    prompt: PromptAssembly,
    *,
    max_attempts: int = MAX_CONTENT_ATTEMPTS,
    sleep: Callable[[float], Awaitable[Any]] = asyncio.sleep,
    retry_delay_seconds: float = 2.0,
) -> list[ContentItemVersion]:
    """Generate a complete pack with bounded schema repair and safe retry."""
    current_prompt = prompt
    last_error: ProviderError | None = None
    for attempt in range(1, max_attempts + 1):
        try:
            items = await provider.generate_content_pack(current_prompt)
            _validate_pack_shape(items)
            return items
        except ProviderError as error:
            last_error = error
            if attempt == max_attempts:
                break
            if error.code in _SCHEMA_ERROR_CODES:
                current_prompt = _repair_prompt(prompt, error, attempt)
            elif error.retryable:
                await sleep(retry_delay_seconds * (2 ** (attempt - 1)))
            else:
                break

    if last_error is None:
        raise ProviderError(
            "CONTENT_PROVIDER_FAILURE",
            "Content provider attempts ended without a result.",
            retryable=True,
        )
    if last_error.code in _SCHEMA_ERROR_CODES:
        raise ProviderError(
            "CONTENT_SCHEMA_FAILURE",
            "Content provider output remained invalid after bounded repair.",
            retryable=False,
        ) from last_error
    if last_error.retryable:
        raise ProviderError(
            "CONTENT_PROVIDER_FAILURE",
            "Content provider remained unavailable after bounded retries.",
            retryable=True,
        ) from last_error
    raise last_error


async def revise_content_item_with_repair(
    provider: ContentLLMProvider,
    prompt: PromptAssembly,
    *,
    base_item_version: ContentItemVersion | None = None,
    max_attempts: int = MAX_CONTENT_ATTEMPTS,
    sleep: Callable[[float], Awaitable[Any]] = asyncio.sleep,
    retry_delay_seconds: float = 2.0,
) -> ContentItemVersion:
    """Revise one item with the same bounded provider safety policy."""
    current_prompt = prompt
    last_error: ProviderError | None = None
    for attempt in range(1, max_attempts + 1):
        try:
            item = await provider.revise_content_item(current_prompt)
            if not isinstance(item, ContentItemVersion):
                raise ProviderError(
                    "CONTENT_SCHEMA_FAILURE",
                    "Content revision did not return one ContentItemVersion.",
                    retryable=False,
                )
            if base_item_version is not None:
                validation = validate_revision_item(base_item_version, item)
                if not validation.valid:
                    issue = validation.issues[0]
                    raise ProviderError(
                        issue.code,
                        f"{issue.field}: {issue.message}",
                        retryable=False,
                    )
            return item
        except ProviderError as error:
            last_error = error
            if attempt == max_attempts:
                break
            if error.code in _SCHEMA_ERROR_CODES:
                current_prompt = _repair_prompt(prompt, error, attempt)
            elif error.retryable:
                await sleep(retry_delay_seconds * (2 ** (attempt - 1)))
            else:
                break

    if last_error is None:
        raise ProviderError(
            "CONTENT_PROVIDER_FAILURE",
            "Content revision attempts ended without a result.",
            retryable=True,
        )
    if last_error.code in _SCHEMA_ERROR_CODES:
        raise ProviderError(
            "CONTENT_SCHEMA_FAILURE",
            "Content revision remained invalid after bounded repair.",
            retryable=False,
        ) from last_error
    if last_error.retryable:
        raise ProviderError(
            "CONTENT_PROVIDER_FAILURE",
            "Content revision provider remained unavailable after bounded retries.",
            retryable=True,
        ) from last_error
    raise last_error
