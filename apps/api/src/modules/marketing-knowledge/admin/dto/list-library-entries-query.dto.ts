import { IsIn, IsInt, IsOptional, IsString, Max, Min } from "class-validator";
import { Type } from "class-transformer";
import { KNOWLEDGE_REVIEW_STATUSES } from "../../taxonomy";

/**
 * Query for listing knowledge library entries from the admin console.
 *
 * `status` filters on the entry's LATEST version review status (an entry's
 * reviewable state is defined by its newest version — older versions are
 * immutable history). Pagination matches the other admin lists.
 */
export class ListLibraryEntriesQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;

  @IsOptional()
  @IsString()
  @IsIn(KNOWLEDGE_REVIEW_STATUSES)
  status?: string;

  @IsOptional()
  @IsString()
  search?: string;
}