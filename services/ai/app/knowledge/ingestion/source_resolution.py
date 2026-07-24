"""Source reference resolution for marketing knowledge entries.

Mirrors the behavior of Docs/marketing-knowledge/_schema/source-resolution.mjs:
- The literal `internal:reviewed-marketing-methodology` reference is always OK.
- Real `https://` URLs are checked with HEAD, falling back to GET on failure.
- Retryable HTTP status codes (408, 429, 5xx) and transient network errors are
  retried up to `max_attempts` with linear backoff.
- Non-retryable 4xx/5xx responses and final failures are reported as errors.
"""

from dataclasses import dataclass
from typing import Optional

import httpx


INTERNAL_REF = "internal:reviewed-marketing-methodology"
DEFAULT_ATTEMPTS = 3
DEFAULT_RETRY_DELAY_MS = 250
DEFAULT_HEAD_TIMEOUT_S = 15
DEFAULT_GET_TIMEOUT_S = 20


@dataclass(frozen=True)
class SourceResolutionResult:
    ok: bool
    url: str
    status: Optional[int] = None
    error: Optional[str] = None
    skipped: bool = False


def _is_retryable_status(status: int) -> bool:
    return status == 408 or status == 429 or status >= 500


async def _fetch_with_retry(
    client: httpx.AsyncClient,
    url: str,
    method: str,
    timeout_s: float,
    max_attempts: int,
    retry_delay_ms: int,
) -> tuple[Optional[httpx.Response], Optional[str]]:
    """Attempt a request up to max_attempts, returning the final response or error."""
    last_error: Optional[str] = None
    for attempt in range(1, max_attempts + 1):
        try:
            response = await client.request(
                method=method,
                url=url,
                timeout=timeout_s,
                follow_redirects=True,
            )
            if not _is_retryable_status(response.status_code) or attempt == max_attempts:
                return response, None
            await response.aclose()
        except (httpx.NetworkError, httpx.TimeoutException) as exc:
            last_error = f"{type(exc).__name__}: {exc}"
            if attempt == max_attempts:
                return None, last_error
        # Linear backoff before the next attempt.
        import asyncio

        await asyncio.sleep((retry_delay_ms * attempt) / 1000)
    return None, last_error or "fetch failed"


async def resolve_source(
    url: str,
    *,
    max_attempts: int = DEFAULT_ATTEMPTS,
    retry_delay_ms: int = DEFAULT_RETRY_DELAY_MS,
    head_timeout_s: float = DEFAULT_HEAD_TIMEOUT_S,
    get_timeout_s: float = DEFAULT_GET_TIMEOUT_S,
    client: Optional[httpx.AsyncClient] = None,
) -> SourceResolutionResult:
    """Resolve a single source reference.

    Returns `ok=True` for the internal methodology reference or for any URL
    that responds with <400 on HEAD or GET. Returns `ok=False` on final failure.
    """
    if url == INTERNAL_REF:
        return SourceResolutionResult(ok=True, url=url, skipped=True)

    own_client = client is None
    http_client = client or httpx.AsyncClient()
    try:
        # Try HEAD first (lightweight).
        head_response, head_error = await _fetch_with_retry(
            http_client,
            url,
            "HEAD",
            head_timeout_s,
            max_attempts,
            retry_delay_ms,
        )
        if head_response is not None and head_response.status_code < 400:
            return SourceResolutionResult(ok=True, url=url, status=head_response.status_code)

        # Fall back to GET.
        get_response, get_error = await _fetch_with_retry(
            http_client,
            url,
            "GET",
            get_timeout_s,
            max_attempts,
            retry_delay_ms,
        )
        if get_response is not None:
            if get_response.status_code < 400:
                return SourceResolutionResult(ok=True, url=url, status=get_response.status_code)
            return SourceResolutionResult(
                ok=False,
                url=url,
                status=get_response.status_code,
                error=f"HTTP {get_response.status_code}",
            )

        return SourceResolutionResult(ok=False, url=url, error=get_error or head_error or "fetch failed")
    finally:
        if own_client:
            await http_client.aclose()
