import { IsString, IsNotEmpty, MinLength, MaxLength } from 'class-validator';

export class ResetPasswordDto {
  @IsString()
  @IsNotEmpty({ message: 'token must not be empty' })
  token: string;

  @IsString()
  @MinLength(8, { message: 'newPassword must be at least 8 characters long' })
  @MaxLength(128, { message: 'newPassword must not exceed 128 characters' })
  newPassword: string;
}
