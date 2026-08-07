import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Validate,
} from "class-validator";
import { LanguageModeDto } from "./start-discovery.dto";
import { MarketAwareBusinessFacts } from "../discovery-state";
import { IsMarketAwareBusinessFactsConstraint } from "./is-market-aware-business-facts.validator";

export class DiscoveryRespondDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  message!: string;

  @IsOptional()
  @IsEnum(LanguageModeDto)
  language?: LanguageModeDto;
}

export class ConfirmProfileDto {
  @IsUUID()
  profile_draft_id!: string;

  @IsBoolean()
  owner_confirmation!: true;

  @IsOptional()
  @IsBoolean()
  acknowledge_incomplete?: true;

  @IsOptional()
  @Validate(IsMarketAwareBusinessFactsConstraint)
  confirmed_facts?: MarketAwareBusinessFacts;
}

export class DiscoverySummarizeDto {
  @IsOptional()
  @IsBoolean()
  finish_anyway?: boolean;
}
