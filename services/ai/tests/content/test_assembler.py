"""Tests for Content prompt assembly and reproducibility metadata."""

import pytest

from content_contracts import (
    AiContentReviseRequest,
    AiStaticAssetGenerateRequest,
    ContentItemVersion,
)

from app.content.assembler import (
    PromptAssembly,
    assemble_asset_prompt,
    assemble_generation_prompt,
    assemble_revision_prompt,
)
from app.content.prompt_versions import (
    CONTENT_ASSET_PROMPT_VERSION,
    CONTENT_GENERATE_PROMPT_VERSION,
    CONTENT_REFERENCE_PATTERN_VERSION,
    CONTENT_REVISE_PROMPT_VERSION,
)
from tests.content.fixture_helpers import load_example, make_valid_request


PROVIDER_NAME = "mock"
MODEL_NAME = "mock-content-model"


def _base_item_version() -> ContentItemVersion:
    data = load_example("content-pack-week-1-ar.example.json")["item_version"]
    return ContentItemVersion.model_validate(data)


def _revision_request(item: ContentItemVersion) -> AiContentReviseRequest:
    return AiContentReviseRequest(
        contract_version="content-v1",
        content_pack_id=item.content_pack_id,
        content_item_id=item.content_item_id,
        base_item_version_id=item.id,
        revision_notes="اجعل الدعوة إلى الإجراء أوضح.",
        idempotency_key="revision-assembler-fictional",
    )


def test_generation_assembly_contains_grounding_metadata() -> None:
    request = make_valid_request()

    assembly = assemble_generation_prompt(request, PROVIDER_NAME, MODEL_NAME)

    assert isinstance(assembly, PromptAssembly)
    assert assembly.system_prompt
    assert assembly.user_prompt
    assert assembly.metadata["prompt_version"] == CONTENT_GENERATE_PROMPT_VERSION
    assert assembly.metadata["reference_pattern_version"] == CONTENT_REFERENCE_PATTERN_VERSION
    assert assembly.metadata["provider_name"] == PROVIDER_NAME
    assert assembly.metadata["model"] == MODEL_NAME
    assert assembly.metadata["contract_version"] == "content-v1"
    assert assembly.metadata["strategy_id"] == request.strategy_id
    assert assembly.metadata["strategy_version"] == request.strategy_version
    assert assembly.metadata["week_number"] == request.week_context.week_number
    assert assembly.metadata["profile_version_id"] == request.business_profile.id
    assert assembly.metadata["input_snapshot_hash"]
    assert "Koshary Corner" not in str(assembly.metadata)


def test_generation_assembly_rejects_invalid_grounding_before_provider() -> None:
    request = make_valid_request().model_copy(update={"selected_channels": ["facebook"]})

    with pytest.raises(ValueError, match="CONTENT_CHANNEL_MISMATCH"):
        assemble_generation_prompt(request, PROVIDER_NAME, MODEL_NAME)


def test_revision_assembly_preserves_identity_metadata() -> None:
    item = _base_item_version()
    request = _revision_request(item)

    assembly = assemble_revision_prompt(request, item, PROVIDER_NAME, MODEL_NAME)

    assert assembly.metadata["prompt_version"] == CONTENT_REVISE_PROMPT_VERSION
    assert assembly.metadata["content_pack_id"] == item.content_pack_id
    assert assembly.metadata["content_item_id"] == item.content_item_id
    assert assembly.metadata["base_item_version_id"] == item.id
    assert assembly.metadata["base_item_version"] == item.version
    assert assembly.metadata["revision_notes_hash"]
    assert request.revision_notes not in str(assembly.metadata)


def test_revision_assembly_rejects_mismatched_base_version() -> None:
    item = _base_item_version()
    request = _revision_request(item).model_copy(
        update={"base_item_version_id": "99999999-9999-4999-8999-999999999998"}
    )

    with pytest.raises(ValueError, match="CONTENT_VERSION_CONFLICT"):
        assemble_revision_prompt(request, item, PROVIDER_NAME, MODEL_NAME)


def test_asset_assembly_records_dimensions_without_raw_brief_metadata() -> None:
    request = AiStaticAssetGenerateRequest(
        contract_version="content-v1",
        asset_id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        content_item_version_id="99999999-9999-4999-8999-999999999999",
        creative_brief="Fictional Koshary Corner static image brief.",
        alt_text="Fictional koshary dish",
        width=1080,
        height=1080,
        idempotency_key="asset-assembler-fictional",
    )

    assembly = assemble_asset_prompt(request, PROVIDER_NAME, MODEL_NAME)

    assert assembly.metadata["prompt_version"] == CONTENT_ASSET_PROMPT_VERSION
    assert assembly.metadata["dimensions"] == {"width": 1080, "height": 1080}
    assert assembly.metadata["idempotency_key_hash"]
    assert request.creative_brief not in str(assembly.metadata)


@pytest.mark.parametrize(
    "request_update",
    [
        {"width": 0},
        {"height": -1},
        {"creative_brief": "   "},
        {"alt_text": "   "},
    ],
)
def test_asset_assembly_rejects_invalid_input(request_update: dict) -> None:
    request = AiStaticAssetGenerateRequest(
        contract_version="content-v1",
        asset_id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        content_item_version_id="99999999-9999-4999-8999-999999999999",
        creative_brief="Fictional creative brief.",
        alt_text="Fictional alt text",
        width=1080,
        height=1080,
        idempotency_key="asset-invalid-fictional",
    ).model_copy(update=request_update)

    with pytest.raises(ValueError, match="CONTENT_SCHEMA_FAILURE"):
        assemble_asset_prompt(request, PROVIDER_NAME, MODEL_NAME)
