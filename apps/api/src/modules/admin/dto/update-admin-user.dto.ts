import { Role, UserStatus } from "@prisma/client";
import { IsArray, IsEnum, IsOptional, IsString, MaxLength } from "class-validator";

export class UpdateAdminUserDto {
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;

  @IsOptional()
  @IsArray()
  @IsEnum(Role, { each: true })
  roles?: Role[];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}