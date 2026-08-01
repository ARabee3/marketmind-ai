"""Immutable item revision and failure-preservation tests."""

from __future__ import annotations

import uuid

import pytest

from content_contracts import AiContentReviseRequest, ContentItemVersion

from app.content.assembler import assemble_revision_prompt
from app.content.service import revise_content_item_with_repair
from app.content.validators import validate_revision_item
from app.providers.base import ProviderError
from app.providers.content_provider import ContentLLMProvider, MockContentProvider
from tests.content.fixture_helpers import load_example


class FixedRevisionProvider(ContentLLMProvider):
    name = "fixed-revision-test"

    def __init__(self, result: object) -> None:
        self.result = result
        self.calls = 0

    async def generate_content_pack(self, prompt):
        raise NotImplementedError

    async def revise_content_item(self, prompt):
        self.calls += 1
        if isinstance(self.result, Exception):
            raise self.result
        return self.result


def _base_item() -> ContentItemVersion:
    return ContentItemVersion.model_validate(
        load_example("content-pack-week-1-ar.example.json")["item_version"]
    )


def _request(base_item: ContentItemVersion) -> AiContentReviseRequest:
    return AiContentReviseRequest(
        contract_version="content-v1",
        content_pack_id=base_item.content_pack_id,
        content_item_id=base_item.content_item_id,
        base_item_version_id=base_item.id,
        revision_notes="اجعل الدعوة إلى الإجراء أوضح.",
        idempotency_key="revision-phase-six-fictional",
    )


def _mutated_revision(base_item: ContentItemVersion, *, field: str) -> ContentItemVersion:
    data = base_item.model_dump(mode="json")
    data["id"] = str(uuid.uuid5(uuid.NAMESPACE_URL, f"{base_item.id}:invalid"))
    data["version"] = base_item.version + 1
    data["version_checksum"] = "new-invalid-revision-checksum"
    data["generation_provenance"]["generation_run_id"] = str(
        uuid.uuid5(uuid.NAMESPACE_URL, f"{base_item.id}:run:invalid")
    )
    if field == "channel":
        mutated_channel = "instagram" if base_item.channel == "facebook" else "facebook"
        data["channel"] = mutated_channel
        data["strategy_trace"]["channel"] = mutated_channel
    elif field == "pillar_ids":
        data["strategy_trace"]["pillar_ids"] = []
    elif field == "strategy_version":
        data["strategy_trace"]["strategy_version"] = base_item.strategy_trace.strategy_version + 1
    return ContentItemVersion.model_validate(data)


@pytest.mark.asyncio
async def test_valid_revision_creates_next_immutable_version() -> None:
    base_item = _base_item()
    request = _request(base_item)
    prompt = assemble_revision_prompt(request, base_item, "mock", "mock-content-model")
    provider = MockContentProvider()

    revised = await revise_content_item_with_repair(
        provider,
        prompt,
        base_item_version=base_item,
    )
    validation = validate_revision_item(base_item, revised)

    assert validation.valid
    assert revised.id != base_item.id
    assert revised.version == base_item.version + 1
    assert revised.content_item_id == base_item.content_item_id
    assert revised.channel == base_item.channel
    assert revised.strategy_trace == base_item.strategy_trace
    assert revised.version_checksum != base_item.version_checksum


@pytest.mark.parametrize("field", ["channel", "pillar_ids", "strategy_version"])
@pytest.mark.asyncio
async def test_locked_revision_mutation_is_rejected_without_retry(field: str) -> None:
    base_item = _base_item()
    request = _request(base_item)
    prompt = assemble_revision_prompt(request, base_item, "mock", "mock-content-model")
    provider = FixedRevisionProvider(_mutated_revision(base_item, field=field))
    base_snapshot = base_item.model_dump(mode="json")

    with pytest.raises(ProviderError) as error:
        await revise_content_item_with_repair(
            provider,
            prompt,
            base_item_version=base_item,
        )

    assert error.value.code == "CONTENT_VERSION_CONFLICT"
    assert provider.calls == 1
    assert base_item.model_dump(mode="json") == base_snapshot


@pytest.mark.asyncio
async def test_failed_revision_preserves_previous_version() -> None:
    base_item = _base_item()
    request = _request(base_item)
    prompt = assemble_revision_prompt(request, base_item, "mock", "mock-content-model")
    provider = FixedRevisionProvider(
        ProviderError("CONTENT_PROVIDER_FAILURE", "provider unavailable", retryable=False)
    )
    base_snapshot = base_item.model_dump(mode="json")

    with pytest.raises(ProviderError) as error:
        await revise_content_item_with_repair(
            provider,
            prompt,
            base_item_version=base_item,
        )

    assert error.value.code == "CONTENT_PROVIDER_FAILURE"
    assert provider.calls == 1
    assert base_item.model_dump(mode="json") == base_snapshot


def test_revision_validator_rejects_same_identity_and_checksum() -> None:
    base_item = _base_item()
    unchanged = base_item.model_copy(update={"version": base_item.version + 1})

    result = validate_revision_item(base_item, unchanged)

    assert not result.valid
    assert "CONTENT_VERSION_CONFLICT" in {issue.code for issue in result.issues}
