import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { EXTERNAL_BUDGET_MODES, ExternalBudgetMode } from '@marketmind/contracts';

/**
 * Optional budget amount or range (in EGP). Required when
 * `paidMediaAllowed=true` and `externalBudgetMode` is `monthly_amount` or
 * `three_month_amount`. Either a single number or `{ min_egp, max_egp }`.
 */
export class ExternalBudgetEgpDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  min_egp?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  max_egp?: number;
}

/**
 * Answer to a Strategy-only clarification question posed during brief setup.
 */
export class ClarificationAnswerDto {
  @IsUUID()
  question_id: string;

  @IsString()
  question_text: string;

  @IsString()
  answer_text: string;

  @IsDateString()
  answered_at: string;
}

export class UpsertBriefDto {
  @IsUUID()
  businessProfileVersionId: string;

  @IsString()
  @MinLength(3)
  primaryObjective: string;

  @IsDateString()
  startDate: string;

  @IsIn(['ar-EG', 'en', 'mixed'])
  planLanguage: string;

  @IsBoolean()
  paidMediaAllowed: boolean;

  @IsIn(EXTERNAL_BUDGET_MODES)
  externalBudgetMode: ExternalBudgetMode;

  /**
   * Optional owner budget amount or range in EGP. Required when
   * `paidMediaAllowed=true` with `monthly_amount` or `three_month_amount`.
   * Either a number or `{ min_egp, max_egp }`; null when organic_only.
   */
  @IsOptional()
  @IsNumber({ allowNaN: false }, { each: false })
  @Min(0)
  externalBudgetEgpAmount?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => ExternalBudgetEgpDto)
  externalBudgetEgpRange?: ExternalBudgetEgpDto;

  @IsString()
  @MinLength(2)
  teamCapacity: string;

  @IsOptional()
  @IsString()
  constraints?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ClarificationAnswerDto)
  clarificationAnswers?: ClarificationAnswerDto[];
}