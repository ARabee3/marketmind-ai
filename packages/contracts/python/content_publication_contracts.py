from __future__ import annotations

import hashlib
import json
from datetime import datetime
from typing import Literal

from pydantic import Field

from content_base import ContentChannel, ContentFormat, FrozenModel, UUID


class PublicationCandidateAssetV1(FrozenModel):
    asset_id: UUID
    kind: Literal["owner_supplied", "generated_static"]
    mime_type: str
    storage_key: str
    checksum: str


class PublicationCandidateApprovalV1(FrozenModel):
    decision_id: UUID
    decision: Literal["approved"]
    content_item_version_id: UUID
    content_item_version_checksum: str
    decided_by_user_id: UUID
    decided_at: datetime


class PublicationCandidateWindow(FrozenModel):
    starts_at: datetime
    ends_at: datetime
    timezone: Literal["Africa/Cairo"]


class PublicationCandidateV1(FrozenModel):
    contract_version: Literal["publication-candidate-v1"]
    candidate_id: UUID
    business_id: UUID
    strategy_id: UUID
    strategy_version: int
    content_cycle_id: UUID
    strategy_week_number: int = Field(ge=1, le=12)
    content_pack_id: UUID
    content_item_id: UUID
    content_item_version_id: UUID
    content_item_version: int
    content_item_version_checksum: str
    target_channel: ContentChannel
    content_format: ContentFormat
    selected_locale: Literal["ar", "en"]
    caption: str
    cta: str | None
    hashtags: list[str]
    alt_text: str = Field(min_length=1, max_length=100)
    assets: list[PublicationCandidateAssetV1] = Field(min_length=1)
    recommended_publish_window: PublicationCandidateWindow
    approval: PublicationCandidateApprovalV1
    candidate_state: Literal["active", "revoked", "replaced"]
    candidate_checksum: str
    created_at: datetime


class PublicationCandidateCreatedEventV1(FrozenModel):
    event_id: UUID
    event_type: Literal["content.publication_candidate.created.v1"]
    occurred_at: datetime
    correlation_id: UUID
    payload: PublicationCandidateV1


def _canonicalize(value):
    if isinstance(value, list):
        return [_canonicalize(item) for item in value]
    if isinstance(value, dict):
        return {
            key: _canonicalize(child)
            for key, child in sorted(value.items())
        }
    return value


def canonical_publication_candidate_payload(candidate: dict) -> str:
    payload = {key: child for key, child in candidate.items() if key != "candidate_checksum"}
    return json.dumps(_canonicalize(payload), ensure_ascii=False)


def compute_publication_candidate_checksum(candidate: dict) -> str:
    return hashlib.sha256(
        canonical_publication_candidate_payload(candidate).encode("utf-8")
    ).hexdigest()
