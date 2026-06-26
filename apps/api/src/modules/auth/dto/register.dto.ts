import { IsEmail, IsString, MinLength, MaxLength, Matches } from 'class-validator';
import { Transform } from 'class-transformer';

export class RegisterDto {
  /**
   * Must be a valid RFC 5322 email address.
   * Normalised to lowercase so "User@EXAMPLE.com" and "user@example.com"
   * are treated as the same identity.
   */
  @IsEmail({}, { message: 'email must be a valid email address' })
  @Transform(({ value }: { value: string }) => value?.toLowerCase().trim())
  email: string;

  /**
   * Owner's full name for profile initialization, dashboard personalization,
   * and billing purposes. Trimmed to prevent accidental leading/trailing spaces.
   */
  @IsString()
  @Transform(({ value }: { value: string }) => value?.trim())
  @MinLength(3, { message: 'fullName must be at least 3 characters long' })
  @MaxLength(50, { message: 'fullName must not exceed 50 characters' })
  @Matches(/^[a-zA-Z\s]+$/, { message: 'fullName can only contain letters and spaces' }) // اختياري: لو عاوز تمنع الرموز والأرقام في الاسم
  fullName: string;

  /**
   * Minimum 8 characters enforces the NIST SP 800-63B baseline.
   * Maximum 72 characters matches bcrypt's effective input length limit,
   * preventing a silent truncation surprise.
   */
  @IsString()
  @MinLength(8, { message: 'password must be at least 8 characters long' })
  @MaxLength(72, { message: 'password must not exceed 72 characters' })
  password: string;
}