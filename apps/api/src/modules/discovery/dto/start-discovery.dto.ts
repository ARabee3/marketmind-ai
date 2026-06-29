import { Type } from "class-transformer";
import {
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  ValidateNested,
} from "class-validator";

export enum LanguageModeDto {
  ArabicEgypt = "ar-EG",
  English = "en",
  Mixed = "mixed",
}

export enum SocialPlatformDto {
  Facebook = "facebook",
  Instagram = "instagram",
  Tiktok = "tiktok",
  Website = "website",
  GoogleMaps = "google_maps",
  Delivery = "delivery",
  Other = "other",
}

export class SocialLinkInputDto {
  @IsEnum(SocialPlatformDto)
  platform!: SocialPlatformDto;

  @IsUrl({ require_tld: false })
  url!: string;
}

export class PreparedDiscoveryIntakeDto {
  @IsString()
  @IsNotEmpty()
  business_name!: string;

  @IsString()
  @IsNotEmpty()
  business_type!: string;

  @IsString()
  @IsNotEmpty()
  city!: string;

  @IsOptional()
  @IsString()
  area?: string;

  @IsOptional()
  @IsString()
  address_text?: string;

  @IsOptional()
  @IsString()
  owner_goal_text?: string;

  @IsOptional()
  @IsString()
  known_competitors_text?: string;

  @IsOptional()
  @IsString()
  target_audience_text?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SocialLinkInputDto)
  social_links?: SocialLinkInputDto[];
}

export class StartDiscoveryDto {
  @ValidateNested()
  @Type(() => PreparedDiscoveryIntakeDto)
  intake!: PreparedDiscoveryIntakeDto;

  @IsOptional()
  @IsEnum(LanguageModeDto)
  language_mode?: LanguageModeDto;
}
