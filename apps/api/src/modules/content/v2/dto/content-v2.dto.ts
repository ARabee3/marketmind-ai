import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
  Max,
  ValidateBy,
  ValidateNested,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from "class-validator";
import { Type } from "class-transformer";
import {
  CONTENT_CHANNELS,
  CONTENT_FORMATS,
  type LanguageMode,
} from "@marketmind/contracts";

const CTA_DESTINATION_TYPES = [
  "phone",
  "whatsapp",
  "website",
  "address",
  "none",
] as const;

@ValidatorConstraint({ name: "contentCtaDestination", async: false })
class ContentCtaDestinationConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value !== "object" || value === null) return false;
    const destination = value as { type?: unknown; value?: unknown };
    if (
      typeof destination.type !== "string" ||
      !(CTA_DESTINATION_TYPES as readonly string[]).includes(destination.type)
    ) {
      return false;
    }
    if (destination.value !== null && typeof destination.value !== "string") {
      return false;
    }
    if (
      destination.type === "none" &&
      destination.value !== null &&
      destination.value !== ""
    ) {
      return false;
    }
    return true;
  }
}

function IsObjectDestination(): PropertyDecorator {
  return ValidateBy({
    name: "contentCtaDestination",
    validator: new ContentCtaDestinationConstraint(),
  });
}

export class UpsertEditorialProfileDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  audience_nuance: string;

  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  voice: string;

  @IsString()
  @IsIn(["ar-EG", "en", "mixed"])
  language: LanguageMode;

  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(2000, { each: true })
  writing_guardrails: string[];

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  default_visual_guidance: string | null;
}

export class CreateCtaEntryDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  label: string;

  @IsObjectDestination()
  destination: { type: string; value: string | null };

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  campaign_context: string | null;

  @IsOptional()
  @IsBoolean()
  active: boolean;
}

export class UpdateCtaEntryDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  label: string;

  @IsOptional()
  @IsObjectDestination()
  destination: { type: string; value: string | null };

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  campaign_context: string | null;

  @IsOptional()
  @IsBoolean()
  active: boolean;
}

export class PostPlanDto {
  @IsInt()
  @Min(1)
  @Max(5)
  position: number;

  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  purpose: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  intended_audience: string | null;

  @IsString()
  @IsIn(CONTENT_CHANNELS)
  channel: string;

  @IsString()
  @IsIn(CONTENT_FORMATS)
  format: string;

  @IsOptional()
  @IsUUID()
  cta_library_entry_id: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  owner_instructions: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  visual_direction: string | null;

  @IsArray()
  @IsUUID("4", { each: true })
  selected_media_ids: string[];
}

export class CreateOrReplaceWeekPlanDto {
  @IsArray()
  @ArrayMinSize(3)
  @ArrayMaxSize(5)
  post_plans: PostPlanDto[];
}

export class CaptionVariantEditDto {
  @IsString()
  @IsCaptionLocale()
  locale: string;

  @IsString()
  dialect: string;

  @IsString()
  @MaxLength(2200)
  caption: string;

  @IsOptional()
  @IsString()
  cta: string | null;

  @IsArray()
  @IsString({ each: true })
  hashtags: string[];
}

function IsCaptionLocale(): PropertyDecorator {
  return ValidateBy({
    name: "contentCaptionLocale",
    validator: {
      validate: (value: unknown) => value === "ar" || value === "en",
    },
  });
}

export class OwnerContentDirectEditDto {
  @IsString()
  contract_version: "content-v2";

  @IsUUID()
  content_item_id: string;

  @IsUUID()
  base_version_id: string;

  @IsString()
  @MinLength(64)
  @MaxLength(64)
  base_version_checksum: string;

  @IsArray()
  @ArrayMaxSize(2)
  @ValidateNested({ each: true })
  @Type(() => CaptionVariantEditDto)
  caption_variants: CaptionVariantEditDto[];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  cta: string | null;

  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(50, { each: true })
  hashtags: string[];

  @IsString()
  @MaxLength(100)
  alt_text: string;

  @IsString()
  @MaxLength(3000)
  creative_brief: string;

  @IsString()
  @MinLength(1)
  idempotency_key: string;
}

export class RewriteContentItemDto {
  @IsString()
  contract_version: "content-v2";

  @IsUUID()
  base_version_id: string;

  @IsString()
  @MinLength(64)
  @MaxLength(64)
  base_version_checksum: string;

  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  revision_notes: string;

  @IsString()
  @MinLength(1)
  idempotency_key: string;
}
