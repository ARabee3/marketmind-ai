import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator';

export class OwnerDecisionDto {
  @IsUUID()
  versionId: string;

  @IsIn(['approve', 'reject', 'revision_requested'])
  action: 'approve' | 'reject' | 'revision_requested';

  @IsOptional()
  @IsString()
  feedback?: string;
}
