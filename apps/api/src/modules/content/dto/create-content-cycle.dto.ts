import {
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import { UpsertWeekContextDto } from "./upsert-week-context.dto";

/**
 * Request body for POST /content-cycles.
 *
 * Matches the `CreateContentCycleRequest` contract shape (snake_case). The
 * server is authoritative for week 1's number and start date; the client
 * supplies the confirmed context inputs.
 */
export class CreateContentCycleDto {
  @IsUUID()
  business_id: string;

  @IsUUID()
  strategy_id: string;

  @IsInt()
  @Min(1)
  strategy_version: number;

  @IsUUID()
  strategy_decision_id: string;

  @IsString()
  idempotency_key: string;

  @ValidateNested()
  @Type(() => UpsertWeekContextDto)
  initial_week_context: UpsertWeekContextDto;
}
