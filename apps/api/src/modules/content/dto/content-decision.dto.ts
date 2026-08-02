import { IsIn, IsOptional, IsString, IsUUID } from "class-validator";

/**
 * Request body for POST /content-packs/:id/items/:item_id/decisions.
 *
 * Matches the `ContentDecisionRequest` contract shape (snake_case). The
 * decision always targets one exact immutable version: the version id and its
 * checksum are both verified server-side against the item's current version.
 */
export class ContentDecisionDto {
  @IsUUID()
  content_item_id: string;

  @IsUUID()
  content_item_version_id: string;

  @IsString()
  content_item_version_checksum: string;

  @IsIn(["approved", "rejected", "revision_requested"])
  decision: "approved" | "rejected" | "revision_requested";

  @IsOptional()
  @IsString()
  revision_notes: string | null;

  @IsString()
  idempotency_key: string;
}
