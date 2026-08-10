"""Provider and bounded structured-output repair tests."""

from __future__ import annotations

import logging
from types import SimpleNamespace

import pytest

from content_contracts import ContentItemVersion

from app.content.assembler import assemble_generation_prompt, assemble_revision_prompt
from app.content.service import (
    generate_content_pack_with_repair,
    revise_content_item_with_repair,
)
from app.content.validators import compute_content_item_checksum
from app.providers.base import ProviderError
from app.providers.content_provider import (
    ContentLLMProvider,
    MockContentProvider,
    OpenAIContentProvider,
    _parse_provider_output,
)
from tests.content.fixture_helpers import load_example, make_valid_request


class SequenceProvider(ContentLLMProvider):
    name = "test-sequence"

    def __init__(
        self,
        pack_results: list[object],
        revision_results: list[object] | None = None,
    ) -> None:
        self.pack_results = list(pack_results)
        self.revision_results = list(revision_results or [])
        self.pack_calls = 0
        self.revision_calls = 0
        self.prompts = []

    async def generate_content_pack(self, prompt):
        self.pack_calls += 1
        self.prompts.append(prompt)
        result = self.pack_results.pop(0)
        if isinstance(result, Exception):
            raise result
        return result

    async def revise_content_item(self, prompt):
        self.revision_calls += 1
        self.prompts.append(prompt)
        result = self.revision_results.pop(0)
        if isinstance(result, Exception):
            raise result
        return result


async def no_sleep(_: float) -> None:
    return None


def _base_item() -> ContentItemVersion:
    return ContentItemVersion.model_validate(
        load_example("content-pack-week-1-ar.example.json")["item_version"]
    )


def test_mock_provider_returns_three_complete_grounded_items() -> None:
    request = make_valid_request()
    prompt = assemble_generation_prompt(request, "mock", "mock-content-model")
    provider = MockContentProvider()

    import asyncio

    items = asyncio.run(provider.generate_content_pack(prompt))

    assert len(items) == 3
    assert all(isinstance(item, ContentItemVersion) for item in items)
    assert {item.content_pack_id for item in items} == {request.content_pack_id}
    assert {item.strategy_trace.strategy_id for item in items} == {request.strategy_id}
    assert {item.strategy_trace.week_number for item in items} == {1}
    assert all(item.channel == "instagram" for item in items)
    assert all(item.version == 1 for item in items)
    assert all(item.generation_provenance.provider_name == "mock" for item in items)


def test_schema_failure_does_not_echo_private_provider_output() -> None:
    private_value = "private-owner-profile-value"

    with pytest.raises(ProviderError) as error:
        _parse_provider_output(
            {"item_versions": [{"caption_variants": [private_value]}]}
        )

    assert error.value.code == "CONTENT_SCHEMA_FAILURE"
    assert private_value not in str(error.value)


def test_provider_parser_canonicalizes_server_owned_staging_contract() -> None:
    raw_item = _base_item().model_dump(mode="json")
    raw_item["contract_version"] = "content-v2"

    output = _parse_provider_output({"item_versions": [raw_item]})

    assert output.item_versions[0].contract_version == "content-v1"


@pytest.mark.asyncio
async def test_openai_content_adapter_disables_sdk_retries_and_storage(
    monkeypatch,
) -> None:
    import openai

    request = make_valid_request().model_copy(update={"allowed_formats": ["text_post"]})
    prompt = assemble_generation_prompt(request, "openai", "fictional-model")
    valid_items = await MockContentProvider().generate_content_pack(prompt)
    captured: dict = {}

    class FakeResponses:
        def parse(self, **arguments):
            captured["request"] = arguments
            return SimpleNamespace(
                output_parsed={
                    "item_versions": [
                        item.model_dump(mode="json") for item in valid_items
                    ]
                }
            )

    class FakeOpenAI:
        def __init__(self, **arguments):
            captured["client"] = arguments
            self.responses = FakeResponses()

    monkeypatch.setattr(openai, "OpenAI", FakeOpenAI)
    provider = OpenAIContentProvider("fictional-key", "fictional-model", 10)

    result = await provider.generate_content_pack(prompt)

    assert len(result) == 3
    assert captured["client"]["max_retries"] == 0
    assert captured["request"]["store"] is False


@pytest.mark.asyncio
async def test_openai_content_adapter_threads_sampling_settings(monkeypatch) -> None:
    import openai

    request = make_valid_request().model_copy(update={"allowed_formats": ["text_post"]})
    prompt = assemble_generation_prompt(request, "openai", "fictional-model")
    valid_items = await MockContentProvider().generate_content_pack(prompt)
    captured: dict = {}

    class FakeResponses:
        def parse(self, **arguments):
            captured["request"] = arguments
            return SimpleNamespace(
                output_parsed={
                    "item_versions": [
                        item.model_dump(mode="json") for item in valid_items
                    ]
                }
            )

    class FakeOpenAI:
        def __init__(self, **arguments):
            captured["client"] = arguments
            self.responses = FakeResponses()

    monkeypatch.setattr(openai, "OpenAI", FakeOpenAI)
    provider = OpenAIContentProvider(
        "fictional-key", "fictional-model", 10, temperature=0.4, top_p=0.9
    )

    await provider.generate_content_pack(prompt)

    assert captured["request"]["temperature"] == 0.4
    assert captured["request"]["top_p"] == 0.9


@pytest.mark.asyncio
async def test_openai_content_adapter_omits_sampling_when_unset(monkeypatch) -> None:
    import openai

    request = make_valid_request().model_copy(update={"allowed_formats": ["text_post"]})
    prompt = assemble_generation_prompt(request, "openai", "fictional-model")
    valid_items = await MockContentProvider().generate_content_pack(prompt)
    captured: dict = {}

    class FakeResponses:
        def parse(self, **arguments):
            captured["request"] = arguments
            return SimpleNamespace(
                output_parsed={
                    "item_versions": [
                        item.model_dump(mode="json") for item in valid_items
                    ]
                }
            )

    class FakeOpenAI:
        def __init__(self, **arguments):
            captured["client"] = arguments
            self.responses = FakeResponses()

    monkeypatch.setattr(openai, "OpenAI", FakeOpenAI)
    provider = OpenAIContentProvider("fictional-key", "fictional-model", 10)

    await provider.generate_content_pack(prompt)

    assert "temperature" not in captured["request"]
    assert "top_p" not in captured["request"]


@pytest.mark.asyncio
async def test_generation_repairs_schema_failure_once() -> None:
    request = make_valid_request()
    prompt = assemble_generation_prompt(request, "mock", "mock-content-model")
    valid_items = await MockContentProvider().generate_content_pack(prompt)
    provider = SequenceProvider([[], valid_items])

    items = await generate_content_pack_with_repair(
        provider,
        prompt,
        sleep=no_sleep,
    )

    assert len(items) == 3
    assert provider.pack_calls == 2
    assert provider.prompts[1].metadata["repair_attempt"] == 1
    assert "STRUCTURED OUTPUT REPAIR" in provider.prompts[1].system_prompt


@pytest.mark.asyncio
async def test_generation_repair_prompt_retains_prior_validation_failures() -> None:
    request = make_valid_request()
    prompt = assemble_generation_prompt(request, "mock", "mock-content-model")
    valid_items = await MockContentProvider().generate_content_pack(prompt)
    provider = SequenceProvider(
        [
            ProviderError("CONTENT_SCHEMA_FAILURE", "first-shape-error", False),
            ProviderError("CONTENT_UNSUPPORTED_CLAIM", "second-claim-error", False),
            valid_items,
        ]
    )

    items = await generate_content_pack_with_repair(
        provider,
        prompt,
        sleep=no_sleep,
    )

    assert len(items) == 3
    assert provider.pack_calls == 3
    assert "first-shape-error" in provider.prompts[2].user_prompt
    assert "second-claim-error" in provider.prompts[2].user_prompt


@pytest.mark.asyncio
async def test_generation_schema_failure_becomes_stable_safe_failure() -> None:
    request = make_valid_request()
    prompt = assemble_generation_prompt(request, "mock", "mock-content-model")
    provider = SequenceProvider([[], [], []])

    with pytest.raises(ProviderError) as error:
        await generate_content_pack_with_repair(provider, prompt, sleep=no_sleep)

    assert error.value.code == "CONTENT_SCHEMA_FAILURE"
    assert not error.value.retryable
    assert provider.pack_calls == 3


@pytest.mark.asyncio
async def test_repair_loop_logs_warn_per_attempt(caplog) -> None:
    request = make_valid_request()
    prompt = assemble_generation_prompt(request, "mock", "mock-content-model")
    valid_items = await MockContentProvider().generate_content_pack(prompt)
    provider = SequenceProvider([[], [], valid_items])

    with caplog.at_level(logging.WARNING, logger="app.content.service"):
        await generate_content_pack_with_repair(provider, prompt, sleep=no_sleep)

    warn_records = [r for r in caplog.records if r.levelno == logging.WARNING]
    assert len(warn_records) >= 2
    assert any("attempt=1" in r.getMessage() for r in warn_records)
    assert any("attempt=2" in r.getMessage() for r in warn_records)
    assert all("CONTENT_SCHEMA_FAILURE" in r.getMessage() for r in warn_records)


@pytest.mark.asyncio
async def test_repair_loop_never_exceeds_max_attempts() -> None:
    request = make_valid_request()
    prompt = assemble_generation_prompt(request, "mock", "mock-content-model")
    provider = SequenceProvider(
        [
            ProviderError("CONTENT_SCHEMA_FAILURE", "bad", False),
            ProviderError("CONTENT_PROVIDER_FAILURE", "down", retryable=True),
            ProviderError("CONTENT_POLICY_VIOLATION", "unsafe", False),
        ]
    )

    with pytest.raises(ProviderError) as error:
        await generate_content_pack_with_repair(
            provider, prompt, sleep=no_sleep, max_attempts=3
        )

    assert provider.pack_calls == 3
    assert error.value.code == "CONTENT_POLICY_VIOLATION"


@pytest.mark.asyncio
async def test_generation_stamps_server_owned_identity_provenance_and_checksum() -> None:
    request = make_valid_request().model_copy(update={"allowed_formats": ["text_post"]})
    prompt = assemble_generation_prompt(request, "mock", "mock-content-model")
    raw_items = await MockContentProvider().generate_content_pack(prompt)
    raw_items = [
        item.model_copy(
            update={
                "id": f"provider-item-{index}",
                "content_item_id": "provider-stable-id",
                "content_pack_id": "provider-pack-id",
                "version": 9,
                "version_checksum": "provider-checksum",
            }
        )
        for index, item in enumerate(raw_items)
    ]
    provider = SequenceProvider([raw_items])

    items = await generate_content_pack_with_repair(
        provider,
        prompt,
        request=request,
        sleep=no_sleep,
    )

    assert len({item.id for item in items}) == 3
    assert len({item.content_item_id for item in items}) == 3
    assert all(item.content_pack_id == request.content_pack_id for item in items)
    assert all(item.version == 1 for item in items)
    assert all(
        item.generation_provenance.provider_name == provider.name for item in items
    )
    assert all(
        item.version_checksum == compute_content_item_checksum(item) for item in items
    )


@pytest.mark.asyncio
async def test_generation_surfaces_platform_constraint_as_advisory_warning() -> None:
    request = make_valid_request()
    prompt = assemble_generation_prompt(request, "mock", "mock-content-model")
    raw_items = await MockContentProvider().generate_content_pack(prompt)
    first = raw_items[0]
    variant = first.caption_variants[0]
    overlong_variant = variant.model_copy(
        update={"caption": variant.caption + (" ا" * 1200)}
    )
    raw_items[0] = first.model_copy(
        update={"caption_variants": [overlong_variant]}
    )
    provider = SequenceProvider([raw_items])

    items = await generate_content_pack_with_repair(
        provider,
        prompt,
        request=request,
        sleep=no_sleep,
    )

    assert "CONTENT_PLATFORM_CONSTRAINT" in items[0].warnings
    assert items[0].blockers == []
    assert items[0].version_checksum == compute_content_item_checksum(items[0])


@pytest.mark.asyncio
async def test_transient_provider_failure_retries_with_backoff() -> None:
    request = make_valid_request()
    prompt = assemble_generation_prompt(request, "mock", "mock-content-model")
    valid_items = await MockContentProvider().generate_content_pack(prompt)
    provider = SequenceProvider(
        [
            ProviderError("CONTENT_PROVIDER_FAILURE", "temporary", retryable=True),
            ProviderError("CONTENT_PROVIDER_FAILURE", "temporary", retryable=True),
            valid_items,
        ]
    )
    delays: list[float] = []

    async def record_sleep(seconds: float) -> None:
        delays.append(seconds)

    items = await generate_content_pack_with_repair(
        provider,
        prompt,
        sleep=record_sleep,
        retry_delay_seconds=0.25,
    )

    assert len(items) == 3
    assert provider.pack_calls == 3
    assert delays == [0.25, 0.5]


@pytest.mark.asyncio
async def test_non_retryable_provider_failure_stops_without_repair() -> None:
    request = make_valid_request()
    prompt = assemble_generation_prompt(request, "mock", "mock-content-model")
    provider = SequenceProvider(
        [ProviderError("CONTENT_PROVIDER_FAILURE", "blocked", retryable=False)]
    )

    with pytest.raises(ProviderError) as error:
        await generate_content_pack_with_repair(provider, prompt, sleep=no_sleep)

    assert error.value.code == "CONTENT_PROVIDER_FAILURE"
    assert provider.pack_calls == 1


@pytest.mark.asyncio
async def test_revision_returns_new_item_version_after_schema_repair() -> None:
    base_item = _base_item()
    from content_contracts import AiContentReviseRequest

    request = AiContentReviseRequest(
        contract_version="content-v1",
        content_pack_id=base_item.content_pack_id,
        content_item_id=base_item.content_item_id,
        base_item_version_id=base_item.id,
        revision_notes="Make the CTA clearer.",
        idempotency_key="revision-provider-fictional",
    )
    prompt = assemble_revision_prompt(request, base_item, "mock", "mock-content-model")
    revised = base_item.model_copy(update={"version": 2})
    provider = SequenceProvider([[]], [ProviderError("CONTENT_SCHEMA_FAILURE", "bad", False), revised])

    result = await revise_content_item_with_repair(provider, prompt, sleep=no_sleep)

    assert result.version == 2
    assert provider.revision_calls == 2
    assert provider.prompts[1].metadata["repair_attempt"] == 1
