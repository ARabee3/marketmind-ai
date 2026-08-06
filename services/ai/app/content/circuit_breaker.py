"""Minimal in-memory circuit breaker for external Content provider calls."""

from __future__ import annotations

import time
from collections.abc import Callable
from typing import Protocol


class _Clock(Protocol):
    def __call__(self) -> float: ...


class CircuitBreaker:
    """Trip open after consecutive provider failures, then cool down.

    Closed: calls allowed. Open: calls are rejected fast without touching the
    provider. After ``cooldown_seconds`` the breaker half-opens (one probe
    allowed); a success closes it, a failure reopens it.
    """

    def __init__(
        self,
        *,
        failure_threshold: int = 5,
        cooldown_seconds: float = 30.0,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._failure_threshold = failure_threshold
        self._cooldown_seconds = cooldown_seconds
        self._clock = clock
        self._failures = 0
        self._open_until: float = 0.0

    @property
    def failures(self) -> int:
        return self._failures

    def allow(self) -> bool:
        if self._failures < self._failure_threshold:
            return True
        return self._clock() >= self._open_until

    def record_failure(self) -> None:
        self._failures += 1
        if self._failures >= self._failure_threshold:
            self._open_until = self._clock() + self._cooldown_seconds

    def record_success(self) -> None:
        self._failures = 0
        self._open_until = 0.0