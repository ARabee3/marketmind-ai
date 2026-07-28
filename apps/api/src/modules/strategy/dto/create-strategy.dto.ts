import { IsUUID } from 'class-validator';

export class CreateStrategyDto {
  @IsUUID()
  businessId: string;
}
