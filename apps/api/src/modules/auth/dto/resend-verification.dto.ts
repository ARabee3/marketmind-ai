import { IsEmail } from 'class-validator';
import { Transform } from 'class-transformer';

export class ResendVerificationDto {
  @IsEmail({}, { message: 'email must be a valid email address' })
  @Transform(({ value }: { value: string }) => value?.toLowerCase().trim())
  email: string;
}