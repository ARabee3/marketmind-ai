import { IsBoolean, IsEnum, IsNotEmpty, IsOptional, IsString, IsUUID } from "class-validator";
import { LanguageModeDto } from "./start-discovery.dto";

export class DiscoveryRespondDto {
  @IsString()
  @IsNotEmpty()
  message!: string;

  @IsOptional()
  @IsEnum(LanguageModeDto)
  language?: LanguageModeDto;
}

export class ConfirmProfileDto {
  @IsUUID("4")
  profile_draft_id!: string;

  @IsBoolean()
  owner_confirmation!: true;
}
