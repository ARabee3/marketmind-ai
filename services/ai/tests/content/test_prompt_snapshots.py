"""Snapshot-style checks for versioned Content prompts."""

import json

from content_contracts import (
    AiContentReviseRequest,
    ContentItemVersion,
    AiStaticAssetGenerateRequest,
)

from app.content.prompt_versions import (
    CONTENT_ASSET_PROMPT_VERSION,
    CONTENT_GENERATE_PROMPT_VERSION,
    CONTENT_REFERENCE_PATTERN_VERSION,
    CONTENT_REVISE_PROMPT_VERSION,
)
from app.content.prompts import (
    CONTENT_ASSET_SYSTEM_PROMPT,
    CONTENT_GENERATE_SYSTEM_PROMPT,
    CONTENT_REVISE_SYSTEM_PROMPT,
    build_asset_user_context,
    build_generate_user_context,
    build_revise_user_context,
)
from tests.content.fixture_helpers import load_example, make_valid_request


def _json_payload(prompt: str) -> dict:
    return json.loads(prompt.split("\n\n", 1)[1])


def test_generate_prompt_has_versioned_safety_boundary() -> None:
    request = make_valid_request()
    prompt = build_generate_user_context(request)

    assert CONTENT_GENERATE_PROMPT_VERSION in CONTENT_GENERATE_SYSTEM_PROMPT
    assert CONTENT_REFERENCE_PATTERN_VERSION in CONTENT_GENERATE_SYSTEM_PROMPT
    for forbidden_rule in (
        "Never invent offers",
        "Never use model memory",
        "preserve protected text",
        "never contain an approval",
    ):
        assert forbidden_rule.lower() in CONTENT_GENERATE_SYSTEM_PROMPT.lower()

    payload = _json_payload(prompt)
    assert payload["generation_identity"]["week_number"] == 1
    assert payload["generation_identity"]["strategy_id"] == request.strategy_id
    assert payload["grounding_inputs"]["strategy_week"]["theme"] == "التعريف بالمطعم"
    assert payload["grounding_inputs"]["weekly_context"]["promotion_mode"] == "owner_approved"
    assert payload["output_contract"]["contract_version"] == "content-v1"


def test_generate_prompt_preserves_fictional_profile_and_redacts_credentials() -> None:
    request = make_valid_request()
    profile = request.business_profile.model_copy(
        update={
            "profile": {
                "business_name": "Koshary Corner",
                "api_key": "fictional-secret",
                "nested": {"password": "fictional-password"},
            }
        }
    )
    request = request.model_copy(update={"business_profile": profile})

    prompt = build_generate_user_context(request)

    assert "Koshary Corner" in prompt
    assert "fictional-secret" not in prompt
    assert "fictional-password" not in prompt
    assert "[REDACTED]" in prompt


def test_revision_prompt_locks_identity_and_keeps_owner_notes() -> None:
    request = AiContentReviseRequest(
        contract_version="content-v1",
        content_pack_id="77777777-7777-4777-8777-777777777777",
        content_item_id="88888888-8888-4888-8888-888888888888",
        base_item_version_id="99999999-9999-4999-8999-999999999999",
        revision_notes="اجعل الدعوة إلى الإجراء أوضح من دون تغيير العرض المعتمد.",
        idempotency_key="revision-fictional-1",
    )
    # The revision builder only needs a contract-shaped item version. Use the
    # shared fictional item fixture rather than introducing real business data.
    item_data = load_example("content-pack-week-1-ar.example.json")["item_version"]
    item = ContentItemVersion.model_validate(item_data)
    prompt = build_revise_user_context(request, item)

    assert CONTENT_REVISE_PROMPT_VERSION in CONTENT_REVISE_SYSTEM_PROMPT
    assert "read-only" in CONTENT_REVISE_SYSTEM_PROMPT.lower()
    assert "strategy_trace.week_number" in prompt
    assert request.revision_notes in prompt
    assert item.id in prompt


def test_asset_prompt_contains_storage_authority_and_provenance() -> None:
    request = AiStaticAssetGenerateRequest(
        contract_version="content-v1",
        content_item_version_id="99999999-9999-4999-8999-999999999999",
        creative_brief="صورة توضح طبق كشري طازج على طاولة بسيطة.",
        alt_text="طبق كشري طازج",
        width=1080,
        height=1080,
        idempotency_key="asset-fictional-1",
    )

    prompt = build_asset_user_context(request)

    assert CONTENT_ASSET_PROMPT_VERSION in CONTENT_ASSET_SYSTEM_PROMPT
    assert "storage-port" in prompt
    assert "provider_request_id" in prompt
    assert request.alt_text in prompt
