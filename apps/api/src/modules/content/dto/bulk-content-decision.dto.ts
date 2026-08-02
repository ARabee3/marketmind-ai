import { ArrayMinSize, IsArray, ValidateNested } from "class-validator";
import { Type } from "class-transformer";
import { ContentDecisionDto } from "./content-decision.dto";

/**
 * Request body for POST /content-packs/:id/decisions/bulk.
 *
 * Wraps an array of per-item decisions; the service partitions them into
 * eligible and ineligible entries and reports each result per item.
 */
export class BulkContentDecisionDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ContentDecisionDto)
  decisions: ContentDecisionDto[];
}
