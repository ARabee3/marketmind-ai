import { IsOptional, IsString, Length } from "class-validator";

export class SubscriptionNoteDto {
  @IsOptional()
  @IsString()
  @Length(0, 500)
  note?: string;
}
