"""Content asset-storage port plus durable local and deterministic test drivers."""

from __future__ import annotations

import hashlib
import os
import tempfile
from abc import ABC, abstractmethod
from dataclasses import dataclass
from functools import partial
from pathlib import Path

from anyio import to_thread


_MIME_EXTENSIONS = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
}


@dataclass(frozen=True)
class StoredAsset:
    """Immutable storage result returned to the Content asset adapter."""

    storage_key: str
    checksum: str
    mime_type: str
    width: int
    height: int


class AssetStoragePort(ABC):
    """Port implemented by the authoritative asset-storage service."""

    available = True

    @abstractmethod
    async def store(
        self,
        data: bytes,
        *,
        mime_type: str,
        width: int,
        height: int,
        asset_id: str,
    ) -> StoredAsset:
        raise NotImplementedError


class DeterministicAssetStorage(AssetStoragePort):
    """In-memory content-addressed driver for local and provider-fake tests."""

    def __init__(self) -> None:
        self._objects: dict[str, bytes] = {}
        self._asset_keys: dict[str, str] = {}

    async def store(
        self,
        data: bytes,
        *,
        mime_type: str,
        width: int,
        height: int,
        asset_id: str,
    ) -> StoredAsset:
        if not data:
            raise ValueError("asset bytes must not be empty")
        checksum = hashlib.sha256(data).hexdigest()
        extension = _MIME_EXTENSIONS.get(mime_type)
        if extension is None:
            raise ValueError("unsupported asset MIME type")
        storage_key = f"content/test/{asset_id}.{extension}"
        existing_key = self._asset_keys.get(asset_id)
        if existing_key is not None and existing_key != storage_key:
            raise ValueError(
                "immutable asset identity already exists with different metadata"
            )
        existing = self._objects.get(storage_key)
        if existing is not None and existing != data:
            raise ValueError("immutable asset identity already stores different bytes")
        self._objects[storage_key] = bytes(data)
        self._asset_keys[asset_id] = storage_key
        return StoredAsset(
            storage_key=storage_key,
            checksum=checksum,
            mime_type=mime_type,
            width=width,
            height=height,
        )

    async def retrieve(self, storage_key: str) -> bytes:
        return self._objects[storage_key]


class UnavailableAssetStorage(AssetStoragePort):
    """Explicitly disabled storage used to prevent false ready assets."""

    available = False

    async def store(
        self,
        data: bytes,
        *,
        mime_type: str,
        width: int,
        height: int,
        asset_id: str,
    ) -> StoredAsset:
        raise OSError("durable Content asset storage is not configured")


class FileSystemAssetStorage(AssetStoragePort):
    """Local/shared-volume driver with immutable, content-addressed writes."""

    def __init__(self, root: str | Path) -> None:
        if not str(root).strip():
            raise ValueError("asset storage root must not be blank")
        self.root = Path(root).expanduser().resolve()

    async def store(
        self,
        data: bytes,
        *,
        mime_type: str,
        width: int,
        height: int,
        asset_id: str,
    ) -> StoredAsset:
        return await to_thread.run_sync(
            self._store_sync,
            bytes(data),
            mime_type,
            width,
            height,
            asset_id,
        )

    def _store_sync(
        self,
        data: bytes,
        mime_type: str,
        width: int,
        height: int,
        asset_id: str,
    ) -> StoredAsset:
        if not data:
            raise ValueError("asset bytes must not be empty")
        extension = _MIME_EXTENSIONS.get(mime_type)
        if extension is None:
            raise ValueError("unsupported asset MIME type")

        storage_key = f"content/generated/{asset_id}.{extension}"
        destination = (self.root / storage_key).resolve()
        try:
            destination.relative_to(self.root)
        except ValueError as exc:
            raise ValueError("asset storage path escaped its configured root") from exc

        for sibling_extension in _MIME_EXTENSIONS.values():
            sibling = (
                self.root
                / "content"
                / "generated"
                / f"{asset_id}.{sibling_extension}"
            ).resolve()
            try:
                sibling.relative_to(self.root)
            except ValueError as exc:
                raise ValueError("asset storage path escaped its configured root") from exc
            if sibling != destination and sibling.exists():
                raise ValueError(
                    "immutable asset identity already exists with different metadata"
                )

        destination.parent.mkdir(parents=True, exist_ok=True)
        checksum = hashlib.sha256(data).hexdigest()

        if destination.exists():
            existing = destination.read_bytes()
            if existing != data:
                raise ValueError("immutable asset identity already stores different bytes")
        else:
            descriptor, temporary_name = tempfile.mkstemp(
                dir=destination.parent,
                prefix=f".{asset_id}.",
                suffix=".tmp",
            )
            temporary = Path(temporary_name)
            try:
                with os.fdopen(descriptor, "wb") as file:
                    file.write(data)
                    file.flush()
                    os.fsync(file.fileno())
                try:
                    os.link(temporary, destination)
                except FileExistsError:
                    existing = destination.read_bytes()
                    if existing != data:
                        raise ValueError(
                            "immutable asset identity already stores different bytes"
                        )
            finally:
                temporary.unlink(missing_ok=True)

        return StoredAsset(
            storage_key=storage_key,
            checksum=checksum,
            mime_type=mime_type,
            width=width,
            height=height,
        )

    async def retrieve(self, storage_key: str) -> bytes:
        target = (self.root / storage_key).resolve()
        try:
            target.relative_to(self.root)
        except ValueError as exc:
            raise ValueError("asset retrieval path escaped its configured root") from exc
        return await to_thread.run_sync(target.read_bytes)


@dataclass(frozen=True)
class R2StorageConfig:
    endpoint_url: str
    access_key_id: str
    secret_access_key: str
    bucket: str
    region: str = "auto"
    timeout_seconds: float = 30.0
    use_path_style_endpoint: bool = True

    @classmethod
    def from_settings(cls, settings) -> "R2StorageConfig":
        return cls(
            endpoint_url=settings.cloudflare_r2_endpoint,
            access_key_id=settings.cloudflare_r2_access_key_id,
            secret_access_key=settings.cloudflare_r2_secret_access_key,
            bucket=settings.cloudflare_r2_bucket,
            use_path_style_endpoint=settings.cloudflare_r2_use_path_style_endpoint,
            timeout_seconds=settings.cloudflare_r2_request_timeout_ms / 1000,
        )


class R2AssetStorage(AssetStoragePort):
    """S3-compatible driver for Cloudflare R2 with atomic immutable writes."""

    available = True

    def __init__(self, config: R2StorageConfig) -> None:
        self._config = config

    async def store(
        self,
        data: bytes,
        *,
        mime_type: str,
        width: int,
        height: int,
        asset_id: str,
    ) -> StoredAsset:
        return await to_thread.run_sync(
            self._store_sync, bytes(data), mime_type, width, height, asset_id
        )

    def _store_sync(
        self,
        data: bytes,
        mime_type: str,
        width: int,
        height: int,
        asset_id: str,
    ) -> StoredAsset:
        if not data:
            raise ValueError("asset bytes must not be empty")
        extension = _MIME_EXTENSIONS.get(mime_type)
        if extension is None:
            raise ValueError("unsupported asset MIME type")

        storage_key = f"content/generated/{asset_id}.{extension}"
        checksum = hashlib.sha256(data).hexdigest()
        client = _r2_client(self._config)
        try:
            client.put_object(
                Bucket=self._config.bucket,
                Key=storage_key,
                Body=data,
                ContentType=mime_type,
                CacheControl="public, max-age=31536000, immutable",
                Metadata={"width": str(width), "height": str(height)},
                IfNoneMatch="*",
            )
        except Exception as error:
            if _is_precondition_failed(error):
                existing = self._retrieve_sync(client, storage_key)
                if existing != data:
                    raise ValueError(
                        "immutable asset identity already stores different bytes"
                    ) from error
            else:
                raise

        return StoredAsset(
            storage_key=storage_key,
            checksum=checksum,
            mime_type=mime_type,
            width=width,
            height=height,
        )

    async def retrieve(self, storage_key: str) -> bytes:
        return await to_thread.run_sync(self._retrieve_sync, _r2_client(self._config), storage_key)

    def _retrieve_sync(self, client, storage_key: str) -> bytes:
        _validate_storage_key(storage_key)
        response = client.get_object(Bucket=self._config.bucket, Key=storage_key)
        return response["Body"].read()

    async def presign_read_url(self, storage_key: str, expires_seconds: int = 3600) -> str:
        _validate_storage_key(storage_key)
        client = _r2_client(self._config)
        return await to_thread.run_sync(
            partial(
                client.generate_presigned_url,
                "get_object",
                Params={"Bucket": self._config.bucket, "Key": storage_key},
                ExpiresIn=expires_seconds,
            )
        )


def _validate_storage_key(storage_key: str) -> None:
    root = Path("content/generated")
    target = Path(storage_key)
    try:
        target.resolve().relative_to(root.resolve())
    except ValueError as exc:
        raise ValueError("asset retrieval path escaped its configured root") from exc


def _is_precondition_failed(error: Exception) -> bool:
    response = getattr(error, "response", None)
    if not isinstance(response, dict):
        return False
    status = response.get("ResponseMetadata", {}).get("HTTPStatusCode")
    if status == 412:
        return True
    code = response.get("Error", {}).get("Code")
    return code in {"PreconditionFailed", "ConditionalRequestConflict"}


def _r2_client(config: R2StorageConfig):
    try:
        import boto3
        from botocore.config import Config
    except ImportError as exc:
        raise ValueError("boto3 is required for the r2 asset storage provider") from exc
    return boto3.client(
        "s3",
        endpoint_url=config.endpoint_url,
        aws_access_key_id=config.access_key_id,
        aws_secret_access_key=config.secret_access_key,
        region_name=config.region,
        config=Config(
            signature_version="s3v4",
            connect_timeout=config.timeout_seconds,
            read_timeout=config.timeout_seconds,
            s3={
                "addressing_style": "path" if config.use_path_style_endpoint else "auto"
            },
        ),
    )


def create_asset_storage(
    *,
    root: str,
    allow_test_memory: bool,
    r2: R2StorageConfig | None = None,
) -> AssetStoragePort:
    """Select R2, durable filesystem, an explicitly labelled test store, or unavailable."""
    if r2 is not None:
        return R2AssetStorage(r2)
    if root.strip():
        return FileSystemAssetStorage(root)
    if allow_test_memory:
        return DeterministicAssetStorage()
    return UnavailableAssetStorage()
