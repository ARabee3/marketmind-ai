"""Live Cloudflare R2 integration round-trip for the R2 asset driver.

Requires ASSET_STORAGE_PROVIDER=r2 and CLOUDFLARE_R2_* set in services/ai/.env.
Skips when unavailable so default CI stays offline.
"""

from __future__ import annotations

import hashlib

import pytest

from app.content.storage import R2AssetStorage, R2StorageConfig, create_asset_storage
from app.core.config import Settings


@pytest.fixture
async def r2_storage() -> R2AssetStorage:
    settings = Settings(asset_storage_provider="r2")
    config = R2StorageConfig.from_settings(settings)
    storage = create_asset_storage(
        root="",
        allow_test_memory=False,
        r2=config if settings.asset_storage_provider == "r2" else None,
    )
    if not settings.asset_storage_provider == "r2" or not config.endpoint_url:
        pytest.skip("R2 not configured: set ASSET_STORAGE_PROVIDER=r2 and CLOUDFLARE_R2_*")
    if not isinstance(storage, R2AssetStorage):
        pytest.skip("R2 provider not active")
    try:
        await storage.presign_read_url("content/generated/_probe.png", expires_seconds=5)
    except Exception as exc:  # noqa: BLE001
        pytest.skip(f"R2 is not reachable: {exc}")
    return storage


@pytest.mark.integration
async def test_r2_real_store_retrieve_roundtrip(r2_storage) -> None:
    data = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
    asset_id = "r2-integration-000000-0000-unique-asset"
    await r2_storage.store(
        data,
        mime_type="image/png",
        width=1080,
        height=1080,
        asset_id=asset_id,
    )

    key = f"content/generated/{asset_id}.png"
    retrieved = await r2_storage.retrieve(key)
    assert retrieved == data
    assert hashlib.sha256(retrieved).hexdigest() == hashlib.sha256(data).hexdigest()


@pytest.mark.integration
async def test_r2_real_immutable_reject_overwrite(r2_storage) -> None:
    asset_id = "r2-integration-immutable-reject-key-0001"
    first = await r2_storage.store(
        b"first-bytes",
        mime_type="image/png",
        width=640,
        height=640,
        asset_id=asset_id,
    )
    assert first.checksum == hashlib.sha256(b"first-bytes").hexdigest()

    with pytest.raises(ValueError, match="different bytes"):
        await r2_storage.store(
            b"different-bytes",
            mime_type="image/png",
            width=640,
            height=640,
            asset_id=asset_id,
        )