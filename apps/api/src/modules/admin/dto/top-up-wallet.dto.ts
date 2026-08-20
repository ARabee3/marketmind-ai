import { IsInt, IsNotEmpty, IsString, Max, MaxLength, Min } from "class-validator";

export class TopUpWalletDto {
  @IsInt()
  @Min(1)
  @Max(1000000)
  points!: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}