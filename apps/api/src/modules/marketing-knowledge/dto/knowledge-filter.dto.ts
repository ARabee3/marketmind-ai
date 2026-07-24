import { IsArray, IsOptional, IsString } from "class-validator";

/**
 * Filter payload for the "only live knowledge" eligibility query. Every
 * array field is optional and, when supplied, narrows the result to entries
 * whose corresponding array column overlaps the supplied values (Postgres
 * `&&` array-overlap semantics).
 */
export class KnowledgeFilterDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  markets?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  industries?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  businessModels?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  objectives?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  funnelStages?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  channels?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  seasons?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  budgetModes?: string[];

  @IsOptional()
  @IsString()
  kind?: string;

  @IsOptional()
  @IsString()
  locale?: string;

  @IsOptional()
  @IsString()
  evidenceTier?: string;
}