import { IsNotEmpty, IsString, MaxLength } from "class-validator";

export class PauseAccountDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}
