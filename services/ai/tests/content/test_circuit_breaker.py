"""Content provider circuit breaker tests.

The breaker protects the external AI provider from being hammered after
repeated unavailable responses (retryable provider errors). Once open, the
service fails fast without calling the provider until the cooldown window
passes.
"""

from __future__ import annotations

import pytest

from app.content.circuit_breaker import CircuitBreaker
from app.content.service import (
    MAX_CONTENT_ATTEMPTS,
    generate_content_pack_with_repair,
)
from app.content.assembler import assemble_generation_prompt
from app.providers.base import ProviderError
from app.providers.content_provider import ContentLLMProvider, MockContentProvider
from tests.content.fixture_helpers import make_valid_request


class FakeClock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


class ExplodingProvider(ContentLLMProvider):
    name = "test-exploding"

    async def generate_content_pack(self, prompt):
        raise ProviderError("CONTENT_PROVIDER_FAILURE", "provider down", retryable=True)

    async def revise_content_item(self, prompt):
        raise ProviderError("CONTENT_PROVIDER_FAILURE", "provider down", retryable=True)


class CountingProvider(ContentLLMProvider):
    name = "test-counting"

    def __init__(self) -> None:
        self.calls = 0

    async def generate_content_pack(self, prompt):
        self.calls += 1
        return []

    async def revise_content_item(self, prompt):
        self.calls += 1
        return None


async def _no_sleep(_: float) -> None:
    return None


def test_breaker_allows_when_closed() -> None:
    breaker = CircuitBreaker()
    assert breaker.allow()


def test_breaker_opens_after_threshold_failures() -> None:
    clock = FakeClock()
    breaker = CircuitBreaker(failure_threshold=2, cooldown_seconds=5.0, clock=clock)
    assert breaker.allow()
    breaker.record_failure()
    assert breaker.allow()
    breaker.record_failure()
    assert not breaker.allow()


def test_open_breaker_recovers_after_cooldown() -> None:
    clock = FakeClock()
    breaker = CircuitBreaker(failure_threshold=1, cooldown_seconds=5.0, clock=clock)
    breaker.record_failure()
    assert not breaker.allow()
    clock.now += 5.0
    assert breaker.allow()
    breaker.record_success()
    assert breaker.allow()


@pytest.mark.asyncio
async def test_open_breaker_fails_fast_without_calling_provider() -> None:
    clock = FakeClock()
    breaker = CircuitBreaker(failure_threshold=1, cooldown_seconds=5.0, clock=clock)
    breaker.record_failure()
    provider = CountingProvider()

    with pytest.raises(ProviderError) as error:
        await generate_content_pack_with_repair(
            provider, None, breaker=breaker, sleep=_no_sleep
        )

    assert error.value.code == "CONTENT_PROVIDER_FAILURE"
    assert provider.calls == 0


@pytest.mark.asyncio
async def test_generation_with_breaker_records_retryable_failure() -> None:
    clock = FakeClock()
    breaker = CircuitBreaker(failure_threshold=3, cooldown_seconds=5.0, clock=clock)
    provider = ExplodingProvider()

    with pytest.raises(ProviderError):
        await generate_content_pack_with_repair(
            provider, None, breaker=breaker, sleep=_no_sleep, max_attempts=1
        )

    assert breaker.failures == 1


class PackProvider(ContentLLMProvider):
    name = "test-pack"

    def __init__(self) -> None:
        self.valid_items = None

    async def generate_content_pack(self, prompt):
        if self.valid_items is None:
            request = make_valid_request()
            self.valid_items = [
                item
                for item in await MockContentProvider().generate_content_pack(
                    assemble_generation_prompt(request, "mock", "mock-content-model")
                )
            ]
        return self.valid_items

    async def revise_content_item(self, prompt):
        return self.valid_items[0]


@pytest.mark.asyncio
async def test_generation_recovery_closes_breaker() -> None:
    clock = FakeClock()
    breaker = CircuitBreaker(failure_threshold=1, cooldown_seconds=5.0, clock=clock)
    breaker.record_failure()
    clock.now += 5.0

    results = await generate_content_pack_with_repair(
        PackProvider(), None, breaker=breaker, sleep=_no_sleep
    )

    assert len(results) == 3
    assert breaker.allow()