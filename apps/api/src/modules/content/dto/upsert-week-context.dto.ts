import {
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";

export class ContentPromotionDto {
  @IsString()
  text: string;

  @IsArray()
  @IsString({ each: true })
  terms: string[];

  @IsDateString()
  valid_from: string;

  @IsDateString()
  valid_until: string;
}

export class ContentCtaDestinationDto {
  @IsIn(["phone", "whatsapp", "website", "address", "none"])
  type: "phone" | "whatsapp" | "website" | "address" | "none";

  @IsOptional()
  @IsString()
  value: string | null;
}

/**
 * Request body for PUT /content-cycles/:id/weeks/:week_number/context.
 *
 * Matches the `ContentWeekContextOwnerInput` contract shape (snake_case).
 * Week number and start date are validated here, but the server is
 * authoritative for both once persisted (the service re-derives them from the
 * cycle's generation schedule).
 */
export class UpsertWeekContextDto {
  @IsInt()
  @Min(1)
  @Max(12)
  week_number: number;

  @IsDateString()
  week_start_date: string;

  @IsIn(["none", "owner_approved"])
  promotion_mode: "none" | "owner_approved";

  @IsOptional()
  @ValidateNested()
  @Type(() => ContentPromotionDto)
  promotion: ContentPromotionDto | null;

  @IsArray()
  @IsString({ each: true })
  must_include: string[];

  @IsArray()
  @IsString({ each: true })
  must_avoid: string[];

  @IsArray()
  @IsUUID("4", { each: true })
  approved_asset_ids: string[];

  @IsObject()
  @ValidateNested()
  @Type(() => ContentCtaDestinationDto)
  cta_destination: ContentCtaDestinationDto;
}
