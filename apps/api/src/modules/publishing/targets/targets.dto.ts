import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsDateString,
  IsInt,
  Min,
} from "class-validator";

export enum TargetProvider {
  META = "META",
}

export class CreateTargetDto {
  @IsString()
  @IsNotEmpty()
  businessId!: string;

  @IsEnum(TargetProvider)
  provider!: TargetProvider;

  @IsString()
  @IsNotEmpty()
  channel!: string; // 'facebook' | 'instagram'

  @IsString()
  @IsNotEmpty()
  externalAccountId!: string;

  @IsString()
  @IsNotEmpty()
  displayName!: string;

  /** Opaque pointer into secrets manager — NEVER the raw token */
  @IsString()
  @IsNotEmpty()
  credentialRef!: string;

  @IsOptional()
  capabilities?: string[];

  @IsDateString()
  @IsOptional()
  expiresAt?: string;
}

export class UpdateTargetConnectionStateDto {
  @IsString()
  @IsNotEmpty()
  connectionState!: "CONNECTED" | "EXPIRED" | "REVOKED" | "ERROR";

  @IsInt()
  @Min(1)
  currentVersion!: number;

  @IsDateString()
  @IsOptional()
  expiresAt?: string;
}

/**
 * §2.2/frozen verify route (POST /publishing-targets/:targetId/verify).
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
