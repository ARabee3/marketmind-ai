"""In-memory fixed-window rate limiter used as an ASGI middleware."""

from __future__ import annotations

import time
from collections.abc import Awaitable, Callable
from typing import Any

from starlette.requests import Request
from starlette.responses import JSONResponse


class FixedWindowLimiter:
    def __init__(self, limit_per_minute: int) -> None:
        self.limit_per_minute = max(0, limit_per_minute)
        self._counts: dict[str, tuple[int, int]] = {}

    def allow(self, key: str) -> bool:
        if self.limit_per_minute == 0:
            return True
        window = int(time.monotonic() // 60)
        count = self._counts.get(key, (window, 0))
        if count[0] != window:
            count = (window, 0)
        if count[1] >= self.limit_per_minute:
            return False
        self._counts[key] = (window, count[1] + 1)
        return True


class RateLimitMiddleware:
    def __init__(
        self,
        app: Any,
        limit_per_minute: int,
    ) -> None:
        self.app = app
        self.limiter = FixedWindowLimiter(limit_per_minute)

    async def __call__(
        self,
        scope: dict[str, Any],
        receive: Callable[..., Awaitable[Any]],
        send: Callable[..., Awaitable[Any]],
    ) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        request = Request(scope)
        client_host = request.client.host if request.client else "unknown"
        if not self.limiter.allow(client_host):
            response = JSONResponse(
                {"detail": "Rate limit exceeded. Try again shortly."},
                status_code=429,
            )
            await response(scope, receive, send)
            return
        await self.app(scope, receive, send)
