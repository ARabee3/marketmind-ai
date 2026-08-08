import {
  IsEnum,
  IsNotEmpty,
  IsString,
  IsInt,
  Min,
  IsOptional,
  IsBoolean,
} from "class-validator";

export enum TargetProvider {
  META = "META",
}

/**
 * Frozen verify route (POST /publishing-targets/:targetId/verify).
 * Idempotency matrix: "Verify/disconnect target — expected_target_version plus
 * idempotency_key". The version guard is authoritative (STALE → STATE_CONFLICT);
 * idempotencyKey is accepted for tracing and future fingerprint storage.
 */
export class VerifyTargetDto {
  @IsString()
  @IsNotEmpty()
  idempotencyKey!: string;

  @IsInt()
  @Min(1)
  expectedTargetVersion!: number;
}

/**
 * `POST /publishing-targets/meta/connect` — initiates the provider OAuth
 * boundary (issue #175). The owner browser NEVER supplies a credentialRef; the
 * OAuth flow proves account ownership and the callback writes the opaque
 * credential reference into the vault. Returns the safe authorization URL.
 */
export class ConnectMetaTargetDto {
  @IsEnum(TargetProvider)
  provider!: TargetProvider;

  @IsString()
  @IsNotEmpty()
  channel!: string; // 'facebook' | 'instagram'

  @IsOptional()
  @IsString()
  locale?: string;

  /** Where to return the owner after the Meta redirect (default /publishing). */
  @IsOptional()
  @IsString()
  returnPath?: string;

  /** Browser fingerprint bound to the state (defence-in-depth CSRF binding). */
  @IsOptional()
  @IsString()
  fingerprint?: string;
}

/** Safe account-selection request (POST /publishing-targets/meta/select). */
export class SelectMetaTargetsDto {
  @IsString()
  @IsNotEmpty()
  connectionId!: string;

  /** Facebook Page id chosen by the owner. */
  @IsString()
  @IsNotEmpty()
  pageId!: string;

  /** Also connect the Page's linked Instagram Professional account. */
  @IsBoolean()
  includeInstagram!: boolean;

  /** Must match the fingerprint bound at connect time. */
  @IsOptional()
  @IsString()
  fingerprint?: string;
}

/** Reconnect journey for an existing target (POST /publishing-targets/meta/reconnect). */
export class ReconnectMetaTargetDto {
  @IsString()
  @IsNotEmpty()
  targetId!: string;

  @IsOptional()
  @IsString()
  locale?: string;

  @IsOptional()
  @IsString()
  returnPath?: string;

  @IsOptional()
  @IsString()
  fingerprint?: string;
}

/**
 * Meta GET callback query (issue #175). The API-owned GET endpoint validates
 * and atomically consumes `state` before any code exchange; the owner browser
 * never POSTs a code to the API. `error`/`error_reason`/`error_description`
 * are mapped to sanitized result codes only — never echoed.
 */
export class MetaCallbackQueryDto {
  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsString()
  state?: string;

  @IsOptional()
  @IsString()
  error?: string;

  @IsOptional()
  @IsString()
  error_reason?: string;

  @IsOptional()
  @IsString()
  error_description?: string;
}

/** Safe projection — credentialRef is stripped, capabilities exposed. */
export interface TargetProjection {
  id: string;
  businessId: string;
  provider: string;
  channel: string;
  externalAccountId: string;
  displayName: string;
  connectionState: string;
  capabilities: unknown;
  lastVerifiedAt: Date | null;
  expiresAt: Date | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}
