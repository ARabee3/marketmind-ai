from __future__ import annotations

import hashlib
import json
from datetime import datetime
from typing import Literal

from pydantic import Field, model_validator

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

    @model_validator(mode="after")
    def validate_range(self) -> "PublicationCandidateWindow":
        if self.starts_at >= self.ends_at:
            raise ValueError("recommended publish window must increase")
        return self


class PublicationCandidateV1(FrozenModel):
    contract_version: Literal["publication-candidate-v1"]
    candidate_id: UUID
    business_id: UUID
    strategy_id: UUID
    strategy_version: int = Field(ge=1)
    content_cycle_id: UUID
    strategy_week_number: int = Field(ge=1, le=12)
    content_pack_id: UUID
    content_item_id: UUID
    content_item_version_id: UUID
    content_item_version: int = Field(ge=1)
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
    candidate_checksum: str = Field(pattern=r"^[a-f0-9]{64}$")
    created_at: datetime

    @model_validator(mode="after")
    def validate_approval_identity(self) -> "PublicationCandidateV1":
        if self.approval.content_item_version_id != self.content_item_version_id:
            raise ValueError("approval item version identity must match candidate")
        if (
            self.approval.content_item_version_checksum
            != self.content_item_version_checksum
        ):
            raise ValueError("approval item version checksum must match candidate")
        return self


class PublicationCandidateStatusV1(FrozenModel):
    contract_version: Literal["publication-candidate-status-v1"]
    candidate_id: UUID
    business_id: UUID
    candidate_checksum: str = Field(pattern=r"^[a-f0-9]{64}$")
    state_version: int = Field(ge=1)
    candidate_state: Literal["active", "revoked", "replaced"]
    replacement_candidate_id: UUID | None
    changed_by_user_id: UUID | None
    changed_at: datetime

    @model_validator(mode="after")
    def validate_replacement(self) -> "PublicationCandidateStatusV1":
        if self.candidate_state == "replaced" and self.replacement_candidate_id is None:
            raise ValueError("replaced candidate needs a replacement identity")
        if self.candidate_state != "replaced" and self.replacement_candidate_id is not None:
            raise ValueError("only replaced candidates may reference a replacement")
        return self


class PublicationCandidateCreatedEventV1(FrozenModel):
    event_id: UUID
    event_type: Literal["content.publication_candidate.created.v1"]
    occurred_at: datetime
    correlation_id: UUID
    payload: PublicationCandidateV1


class PublicationCandidateStateChangedEventV1(FrozenModel):
    event_id: UUID
    event_type: Literal["content.publication_candidate.state_changed.v1"]
    occurred_at: datetime
    correlation_id: UUID
    payload: PublicationCandidateStatusV1

    @model_validator(mode="after")
    def validate_terminal_state(self) -> "PublicationCandidateStateChangedEventV1":
        if self.payload.candidate_state == "active":
            raise ValueError("state-changed event must revoke or replace a candidate")
        return self


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
    return json.dumps(
        _canonicalize(payload),
        ensure_ascii=False,
        separators=(",", ":"),
        allow_nan=False,
    )


def compute_publication_candidate_checksum(candidate: dict) -> str:
    return hashlib.sha256(
        canonical_publication_candidate_payload(candidate).encode("utf-8")
    ).hexdigest()
