import { IsNotEmpty, IsString, IsOptional, IsInt, Min } from "class-validator";

/** Posted by the content pipeline to register a new publication candidate.
 *  NOTE: `businessId` is REQUIRED here for schema validation only — the
 *  controller overrides it with the authenticated session's businessId to
 *  prevent cross-tenant injection (issue #119 G10). A body value that does
 *  not match the session is simply ignored. */
export class IngestCandidateDto {
  @IsString()
  @IsNotEmpty()
  businessId!: string;

  @IsString()
  @IsNotEmpty()
  externalContentId!: string;

  @IsString()
  @IsNotEmpty()
  candidateChecksum!: string;

  @IsString()
  @IsNotEmpty()
  eventFingerprint!: string;

  /** Full frozen PublicationCandidateV1 payload */
  payload!: Record<string, unknown>;

  @IsString()
  @IsNotEmpty()
  channel!: string;

  @IsString()
  @IsNotEmpty()
  format!: string;

  @IsString()
  @IsOptional()
  locale?: string;

  @IsInt()
  @Min(1)
  @IsOptional()
  strategyWeekNumber?: number;
}

/** Posted by the content pipeline to update a candidate's state (revoke/replace). */
export class UpdateCandidateStateDto {
  @IsString()
  @IsNotEmpty()
  newStatus!: "ACTIVE" | "REVOKED" | "REPLACED";

  @IsInt()
  @Min(1)
  sourceStateVersion!: number;

  @IsInt()
  @Min(1)
  currentVersion!: number;
}
