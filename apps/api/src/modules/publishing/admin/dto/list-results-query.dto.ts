import { Type } from "class-transformer";
import {
  IsEnum,
  IsInt,
  IsOptional,
  Max,
  Min,
} from "class-validator";
import { PublishingOutcome } from "@prisma/client";

/**
 * Query parameters for GET /publishing/admin/results.
 *
 * `outcome` filters by result outcome (e.g. UNKNOWN for reconciliation
 * queues); when omitted every outcome is returned, newest first. `page` and
 * `pageSize` control pagination exactly like the admin users/subscriptions
 * lists (defaults 1 and 20, pageSize capped at 100).
 */
export class ListResultsQueryDto {
  @IsOptional()
  @IsEnum(PublishingOutcome)
  outcome?: PublishingOutcome;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}