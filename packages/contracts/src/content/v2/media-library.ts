import type {
  ContentErrorCode,
  IsoDateTime,
  UUID,
} from "../content-types";
import type {
  ContentV2MediaFailureCode,
  ContentV2MediaKind,
  ContentV2MediaStatus,
} from "./content-v2-types";

/**
 * Business/cycle-scoped media library (content-v2, issue #187).
 *
 * Owner-uploaded assets and server-generated static visuals both live here
 * with truthful status. Never expose raw storage keys or cross-owner
 * references; the storage layer owns the bytes and this record owns the
 * safe projection.
 */
export type ContentMediaLibraryEntryV2 = {
  readonly id: UUID;
  readonly contract_version: "content-v2";
  readonly business_id: UUID;
  readonly content_cycle_id: UUID;
  readonly owner_user_id: UUID;
  readonly kind: ContentV2MediaKind;
  readonly status: ContentV2MediaStatus;
  readonly mime_type: string | null;
  readonly size_bytes: number | null;
  readonly width: number | null;
  readonly height: number | null;
  readonly checksum: string | null;
  readonly storage_key: string | null;
  readonly failure_code: ContentV2MediaFailureCode | ContentErrorCode | null;
  readonly created_at: IsoDateTime;
  readonly updated_at: IsoDateTime;
};

/**
 * A selected media reference on a post plan or frozen snapshot. Kept as a
 * lightweight, immutable-by-copy reference: media records can be revoked
 * without rewriting the plans that referenced them.
 */
export type ContentMediaReferenceV2 = {
  readonly media_id: UUID;
  readonly captured_at: IsoDateTime;
};

export type ContentMediaUploadRequest = {
  readonly filename: string;
  readonly content_type: string;
  readonly size_bytes: number;
  readonly idempotency_key: string;
};

export type ContentMediaUploadResponse = {
  readonly media: ContentMediaLibraryEntryV2;
};

export type ContentMediaListResponse = {
  readonly entries: readonly ContentMediaLibraryEntryV2[];
};
