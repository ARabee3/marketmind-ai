import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator';
import { EXTERNAL_BUDGET_MODES, ExternalBudgetMode } from '@marketmind/contracts';

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

  @IsString()
  @MinLength(2)
  teamCapacity: string;

  @IsOptional()
  @IsString()
  constraints?: string;
}
