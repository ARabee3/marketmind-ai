"""Content asset-storage port plus durable local and deterministic test drivers."""

from __future__ import annotations

import hashlib
import os
import tempfile
from abc import ABC, abstractmethod
from dataclasses import dataclass
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


def create_asset_storage(*, root: str, allow_test_memory: bool) -> AssetStoragePort:
    """Select durable storage, an explicitly labelled test store, or unavailable."""
    if root.strip():
        return FileSystemAssetStorage(root)
    if allow_test_memory:
        return DeterministicAssetStorage()
    return UnavailableAssetStorage()
