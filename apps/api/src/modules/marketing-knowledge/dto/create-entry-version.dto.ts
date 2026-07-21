import {
  IsArray,
  IsDateString,
  IsOptional,
  IsString,
} from "class-validator";
import {
  KNOWLEDGE_KINDS,
  KNOWLEDGE_LOCALES,
  KNOWLEDGE_EVIDENCE_TIERS,
} from "../taxonomy";

/**
 * Input payload for creating a new immutable version of a marketing knowledge
 * entry. The entry identity (`slug`) is resolved or created idempotently; the
 * version row is always an INSERT (never an UPDATE of an approved row).
 *
 * Array-element membership is validated in the repository layer against
 * `taxonomy.ts` (no DB CHECK enforces array elements).
 */
export class CreateEntryVersionDto {
  @IsString()
  slug!: string;

  @IsString()
  kind!: string;

  @IsString()
  title!: string;

  @IsString()
  summary!: string;

  @IsString()
  body!: string;

  @IsString()
  locale!: string;

  @IsArray()
  @IsString({ each: true })
  markets: string[] = [];

  @IsArray()
  @IsString({ each: true })
  industries: string[] = [];

  @IsArray()
  @IsString({ each: true })
  businessModels: string[] = [];

  @IsArray()
  @IsString({ each: true })
  objectives: string[] = [];

  @IsArray()
  @IsString({ each: true })
  funnelStages: string[] = [];

  @IsArray()
  @IsString({ each: true })
  channels: string[] = [];

  @IsArray()
  @IsString({ each: true })
  seasons: string[] = [];

  @IsArray()
  @IsString({ each: true })
  budgetModes: string[] = [];

  @IsString()
  evidenceTier!: string;

  @IsOptional()
  @IsString()
  reviewStatus?: string;

  @IsDateString()
  effectiveAt!: string;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;

  @IsString()
  author!: string;

  @IsOptional()
  @IsString()
  reviewer?: string;

  @IsOptional()
  @IsDateString()
  reviewedAt?: string;

  /** Precomputed content checksum; ingestion is responsible for it. */
  @IsString()
  checksum!: string;

  /** Optional sources/citations linked to this version. */
  @IsOptional()
  @IsArray()
  sources?: Array<{ reference: string; note?: string }>;
}

export const CREATE_ENTRY_VERSION_KNOWN_SCALAR_VALUES = {
  kind: KNOWLEDGE_KINDS,
  locale: KNOWLEDGE_LOCALES,
  evidenceTier: KNOWLEDGE_EVIDENCE_TIERS,
};