"""Deterministic test-only asset storage driver boundary."""

from __future__ import annotations

import hashlib
from abc import ABC, abstractmethod
from dataclasses import dataclass


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
        extension = mime_type.rsplit("/", 1)[-1]
        storage_key = f"content/test/{asset_id}.{extension}"
        self._objects[storage_key] = bytes(data)
        return StoredAsset(
            storage_key=storage_key,
            checksum=checksum,
            mime_type=mime_type,
            width=width,
            height=height,
        )

    async def retrieve(self, storage_key: str) -> bytes:
        return self._objects[storage_key]
