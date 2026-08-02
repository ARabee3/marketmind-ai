import { IsInt, IsString, IsUUID, Max, Min } from "class-validator";

/**
 * Request body for POST /content-cycles/:id/weeks/:week_number/generate.
 *
 * Matches the `GenerateContentPackRequest` contract shape (snake_case). The
 * week number comes from the URL path; the body carries the idempotency key
 * that makes a replayed claim resolve to the same pack.
 */
export class GenerateContentWeekDto {
  @IsUUID()
  content_cycle_id: string;

  @IsInt()
  @Min(1)
  @Max(12)
  week_number: number;

  @IsString()
  idempotency_key: string;
}
