import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
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

  @IsUrl({
    protocols: ["http", "https"],
    require_protocol: true,
    require_tld: false,
  })
  @MaxLength(2048)
  url!: string;
}

export class PreparedDiscoveryIntakeDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  business_name!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  business_type!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  city!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  area?: string;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  address_text?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  owner_goal_text?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  known_competitors_text?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  target_audience_text?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(8)
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
