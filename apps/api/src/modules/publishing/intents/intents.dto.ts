import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsInt,
  Min,
  Matches,
} from "class-validator";

export enum PublishingMode {
  REAL = "REAL",
  MANUAL_EXPORT = "MANUAL_EXPORT",
  SIMULATION = "SIMULATION",
}

export class CreateIntentDto {
  @IsString()
  @IsNotEmpty()
  candidateId!: string;

  @IsEnum(PublishingMode)
  @IsOptional()
  mode?: PublishingMode;

  /** Contract publication-v1: one idempotency key per owner action. Replays of
   *  the same create with the same key resolve to the existing intent. */
  @IsString()
  @IsNotEmpty()
  idempotencyKey!: string;
}

export class ScheduleIntentDto {
  /** Naive local datetime without offset, e.g. "2026-09-01T14:00:00" */
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/, {
    message:
      'scheduledLocalAt must be ISO-8601 without timezone offset, e.g. "2026-09-01T14:00:00"',
  })
  scheduledLocalAt!: string;

  /** IANA timezone string */
  @IsString()
  @IsNotEmpty()
  timezone!: string;

  @IsString()
  @IsNotEmpty()
  targetId!: string;

  @IsInt()
  @Min(1)
  currentVersion!: number;

  @IsString()
  @IsNotEmpty()
  idempotencyKey!: string;
}

export class ApproveIntentDto {
  @IsString()
  @IsNotEmpty()
  decision!: "APPROVED" | "REJECTED";

  @IsInt()
  @Min(1)
  currentVersion!: number;

  @IsString()
  @IsNotEmpty()
  candidateChecksum!: string;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsString()
  @IsNotEmpty()
  idempotencyKey!: string;
}

export class CancelIntentDto {
  @IsInt()
  @Min(1)
  currentVersion!: number;

  @IsString()
  @IsNotEmpty()
  idempotencyKey!: string;
}

export class RescheduleIntentDto {
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/)
  scheduledLocalAt!: string;

  @IsString()
  @IsNotEmpty()
  timezone!: string;

  @IsString()
  @IsNotEmpty()
  targetId!: string;

  @IsInt()
  @Min(1)
  currentVersion!: number;

  @IsString()
  @IsNotEmpty()
  idempotencyKey!: string;
}

export class RetryIntentDto {
  @IsInt()
  @Min(1)
  currentVersion!: number;

  /** Contract RetryPublicationIntentRequestV1.idempotency_key. A retry creates
   *  a NEW attempt under the same intent; a fresh key ensures the new attempt
   *  is distinct from prior dispatch attempts. */
  @IsString()
  @IsNotEmpty()
  idempotencyKey!: string;
}

export class ListIntentsQueryDto {
  @IsString()
  @IsOptional()
  status?: string;

  @IsString()
  @IsOptional()
  candidateId?: string;

  @IsString()
  @IsOptional()
  targetId?: string;
}

/** Body for the export/simulate dispatch action endpoints (§8 draft→dispatching). */
export class DispatchLocalActionDto {
  /** One idempotency key per owner export/simulate action (contract). */
  @IsString()
  @IsNotEmpty()
  idempotencyKey!: string;
}
