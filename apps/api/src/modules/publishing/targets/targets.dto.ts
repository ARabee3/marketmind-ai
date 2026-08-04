import {
  IsEnum,
  IsNotEmpty,
  IsString,
  IsInt,
  Min,
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
 * Frozen `POST /publishing-targets/meta/connect` — initiates the provider OAuth
 * boundary. The owner browser never supplies a credentialRef; the OAuth flow
 * proves account ownership and the callback writes the opaque credential
 * reference. Real Meta OAuth lands in #120/#122.
 */
export class ConnectMetaTargetDto {
  @IsEnum(TargetProvider)
  provider!: TargetProvider;

  @IsString()
  @IsNotEmpty()
  channel!: string; // 'facebook' | 'instagram'
}

/** Frozen `POST /publishing-targets/meta/callback` — completes the OAuth
 *  boundary; the provider redirects here with the authorization code. */
export class MetaCallbackDto {
  @IsEnum(TargetProvider)
  provider!: TargetProvider;

  @IsString()
  @IsNotEmpty()
  channel!: string;

  @IsString()
  @IsNotEmpty()
  code!: string;

  @IsString()
  @IsNotEmpty()
  state!: string;
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
