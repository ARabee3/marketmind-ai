"""S3-compatible (Cloudflare R2) asset storage driver tests."""

from __future__ import annotations

import hashlib
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from app.content.storage import (
    R2AssetStorage,
    R2StorageConfig,
    create_asset_storage,
)
from app.providers.base import ProviderError


def _config() -> R2StorageConfig:
    return R2StorageConfig(
        endpoint_url="https://fake.r2.cloudflarestorage.com",
        access_key_id="access-key",
        secret_access_key="secret-key",
        bucket="marketmind-assets",
        region="auto",
        timeout_seconds=10,
    )


def _png_bytes() -> bytes:
    return b"\x89PNG\r\n\x1a\n" + b"\x00" * 32


class FakeClientError(Exception):
    def __init__(self, status: int, code: str) -> None:
        super().__init__(f"{status} {code}")
        self.response = {
            "ResponseMetadata": {"HTTPStatusCode": status},
            "Error": {"Code": code},
        }


class FakeS3Client:
    """In-memory fake covering put_object/get_object with IfNoneMatch=*.

    Mirrors real boto3: any put to an existing key raises 412
    PreconditionFailed (the conditional-write semantics of IfNoneMatch=*).
    """

    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}
        self.put_calls: list[dict] = []
        self.get_calls: list[dict] = []

    def put_object(self, **kwargs) -> dict:
        self.put_calls.append(kwargs)
        key = kwargs["Key"]
        if key in self.objects:
            raise FakeClientError(412, "PreconditionFailed")
        self.objects[key] = kwargs["Body"]
        return {"ResponseMetadata": {"HTTPStatusCode": 200}}

    def get_object(self, **kwargs) -> dict:
        self.get_calls.append(kwargs)
        body = self.objects.get(kwargs["Key"], b"")
        return {"Body": SimpleNamespace(read=lambda: body)}

    def generate_presigned_url(self, client_method: str, **kwargs) -> str:
        params = kwargs["Params"]
        return (
            f"https://presigned/{params['Bucket']}/{params['Key']}"
            f"?method={client_method}"
        )


@pytest.fixture
def fake_s3() -> FakeS3Client:
    return FakeS3Client()


@pytest.fixture
def provider(fake_s3: FakeS3Client):
    with patch("boto3.client", return_value=fake_s3):
        yield R2AssetStorage(_config())


async def test_r2_store_write_and_checksum(provider, fake_s3) -> None:
    stored = await provider.store(
        _png_bytes(),
        mime_type="image/png",
        width=1024,
        height=1024,
        asset_id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    )

    assert stored.storage_key == "content/generated/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.png"
    assert stored.checksum == hashlib.sha256(_png_bytes()).hexdigest()
    assert stored.mime_type == "image/png"
    assert stored.width == 1024
    assert stored.height == 1024
    call = fake_s3.put_calls[-1]
    assert call["Body"] == _png_bytes()
    assert call["Bucket"] == "marketmind-assets"
    assert call["ContentType"] == "image/png"
    assert call["IfNoneMatch"] == "*"


async def test_r2_retrieve_returns_bytes(provider, fake_s3) -> None:
    await provider.store(
        _png_bytes(),
        mime_type="image/png",
        width=1024,
        height=1024,
        asset_id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    )

    retrieved = await provider.retrieve(
        "content/generated/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.png"
    )
    assert retrieved == _png_bytes()


async def test_r2_store_unsupported_mime_raises(provider, fake_s3) -> None:
    with pytest.raises(ValueError, match="unsupported asset MIME type"):
        await provider.store(
            b"data",
            mime_type="application/pdf",
            width=1024,
            height=1024,
            asset_id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        )


async def test_r2_idempotent_store_same_bytes(provider, fake_s3) -> None:
    first = await provider.store(
        _png_bytes(),
        mime_type="image/png",
        width=1024,
        height=1024,
        asset_id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    )
    second = await provider.store(
        _png_bytes(),
        mime_type="image/png",
        width=1024,
        height=1024,
        asset_id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    )
    assert second.storage_key == first.storage_key
    assert second.checksum == first.checksum


async def test_r2_store_different_bytes_same_asset_raises(fake_s3) -> None:
    provider = R2AssetStorage(_config())
    with patch("boto3.client", return_value=fake_s3):
        await provider.store(
            b"first-bytes",
            mime_type="image/png",
            width=1024,
            height=1024,
            asset_id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        )

        with pytest.raises(ValueError, match="different bytes"):
            await provider.store(
                b"different-bytes",
                mime_type="image/png",
                width=1024,
                height=1024,
                asset_id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            )


async def test_r2_presign_read_url(provider) -> None:
    url = await provider.presign_read_url(
        "content/generated/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.png",
        expires_seconds=3600,
    )
    assert "method=get_object" in url


def test_create_asset_storage_r2_priority() -> None:
    storage = create_asset_storage(
        root="/some/dir",
        allow_test_memory=True,
        r2=_config(),
    )
    assert isinstance(storage, R2AssetStorage)


def test_r2_client_built_once_per_storage_instance(fake_s3) -> None:
    with patch("boto3.client", return_value=fake_s3) as client_factory:
        storage = R2AssetStorage(_config())
        import asyncio

        async def exercise() -> None:
            await storage.store(
                _png_bytes(),
                mime_type="image/png",
                width=1024,
                height=1024,
                asset_id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            )
            await storage.retrieve(
                "content/generated/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.png"
            )
            await storage.presign_read_url(
                "content/generated/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.png"
            )

        asyncio.run(exercise())

    assert client_factory.call_count == 1


def test_create_asset_storage_fallbacks_unchanged(tmp_path) -> None:
    from app.content.storage import (
        DeterministicAssetStorage,
        FileSystemAssetStorage,
        UnavailableAssetStorage,
    )

    assert isinstance(create_asset_storage(root=str(tmp_path), allow_test_memory=False), FileSystemAssetStorage)
    assert isinstance(create_asset_storage(root="", allow_test_memory=True), DeterministicAssetStorage)
    assert isinstance(create_asset_storage(root="", allow_test_memory=False), UnavailableAssetStorage)