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
  IsUrl,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  CHANNEL_ROLES,
  CHANNEL_SETUP_STATES,
  EXTERNAL_BUDGET_MODES,
  ExternalBudgetMode,
  STRATEGY_OBJECTIVES,
  STRATEGY_V2_CHANNELS,
  STRATEGY_WEEKLY_CAPACITY_PRESETS,
} from '@marketmind/contracts';

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
  @IsIn(STRATEGY_OBJECTIVES)
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

  @IsOptional()
  @IsString()
  @MinLength(2)
  teamCapacity?: string;

  /**
   * strategy-v2 only: plain-language weekly-capacity preset replacing the
   * free-text `teamCapacity` field.
   */
  @IsOptional()
  @IsIn(STRATEGY_WEEKLY_CAPACITY_PRESETS)
  weeklyCapacity?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  weeklyCapacityNote?: string;

  /**
   * strategy-v2 only: 1–3 unique catalog channels with exactly one primary.
   * The service enforces the invariants after DTO validation.
   */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ChannelChoiceDto)
  channelChoices?: ChannelChoiceDto[];

  @IsOptional()
  @IsString()
  constraints?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ClarificationAnswerDto)
  clarificationAnswers?: ClarificationAnswerDto[];
}

/**
 * Owner-first channel choice (strategy-v2 brief). Never contains a Page ID,
 * access token, credential reference, or provider secret.
 */
export class ChannelChoiceDto {
  @IsIn(STRATEGY_V2_CHANNELS)
  channel: string;

  @IsIn(CHANNEL_ROLES)
  role: string;

  @IsIn(CHANNEL_SETUP_STATES)
  setupState: string;

  /** Only allowed with `existing_link`; owner-managed public presence. */
  @IsOptional()
  @IsUrl({ require_protocol: true, protocols: ['https', 'http'] })
  publicUrl?: string;

  /** Only allowed with `connected`; the safe target projection id (#175). */
  @IsOptional()
  @IsUUID()
  publishingTargetId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}
