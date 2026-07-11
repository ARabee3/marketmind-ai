import { IsString, IsNotEmpty } from 'class-validator';

export class VerifyEmailDto {
  @IsString()
  @IsNotEmpty({ message: 'token must not be empty' })
  token: string;
}
