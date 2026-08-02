"""Phase 0 smoke checks for the frozen Content boundary."""

from content_contracts import (
    AiContentGenerateRequest,
    AiContentGenerateResponse,
    AiContentReviseRequest,
    AiContentReviseResponse,
    AiStaticAssetGenerateRequest,
    AiStaticAssetGenerateResponse,
    ContentAsset,
    ContentItemVersion,
    ContentPack,
    ContentValidationResult,
    ContentWeekContext,
    validate_content_policy_fixture,
)

from app.content import (
    assembler,
    fixtures,
    image_provider,
    prompt_versions,
    prompts,
    service,
    storage,
    validators,
)


def test_frozen_content_contract_and_phase_zero_modules_import() -> None:
    """Keep the FastAPI boundary wired to the reviewed content-v1 models."""
    assert AiContentGenerateRequest.model_fields["contract_version"]
    assert AiContentGenerateResponse.model_fields["item_versions"]
    assert AiContentReviseRequest.model_fields["base_item_version_id"]
    assert AiContentReviseResponse.model_fields["item_version"]
    assert AiStaticAssetGenerateRequest.model_fields["content_item_version_id"]
    assert AiStaticAssetGenerateResponse.model_fields["asset"]
    assert ContentWeekContext.model_fields["weekly_claim_id"]
    assert ContentPack.model_fields["item_ids"]
    assert ContentItemVersion.model_fields["claim_sources"]
    assert ContentAsset.model_fields["provider_request_id"]
    assert ContentValidationResult.model_fields["issues"]
    assert callable(validate_content_policy_fixture)
    assert all(
        module.__name__.startswith("app.content.")
        for module in (
            assembler,
            fixtures,
            image_provider,
            prompt_versions,
            prompts,
            service,
            storage,
            validators,
        )
    )
