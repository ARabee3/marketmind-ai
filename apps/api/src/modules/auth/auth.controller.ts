import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';

import {
  AuthService,
  LoginResponse,
  RefreshResponse,
  SafeUser,
} from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { JwtRefreshGuard } from './guards/jwt-refresh.guard';
import { AuthenticatedUser } from './interfaces/jwt-payload.interface';

interface RequestWithUser extends Request {
  user: AuthenticatedUser;
}

export const REFRESH_TOKEN_COOKIE = 'refreshToken';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 5, ttl: 900000 } })
  async register(@Body() dto: RegisterDto): Promise<SafeUser> {
    return this.authService.register(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 900000 } })
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponse> {
    const { accessToken, rawRefreshToken, user } = await this.authService.login(dto);
    this.setRefreshCookie(res, rawRefreshToken);
    return { accessToken, user };
  }

  @Post('refresh')
  @UseGuards(JwtRefreshGuard)
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 900000 } })
  async refresh(
    @Req() req: RequestWithUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<RefreshResponse> {
    const { accessToken, rawRefreshToken } = await this.authService.refresh(req.user);
    this.setRefreshCookie(res, rawRefreshToken);
    return { accessToken };
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Req() req: RequestWithUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.authService.logout(req.user.id);
    this.clearRefreshCookie(res);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async getMe(@Req() req: RequestWithUser): Promise<SafeUser> {
    return this.authService.getMe(req.user.id);
  }

  private setRefreshCookie(res: Response, token: string): void {
    res.cookie(REFRESH_TOKEN_COOKIE, token, {
      httpOnly: true,
      secure: this.configService.get<boolean>('cookies.secure', false),
      sameSite: this.configService.get<'lax' | 'strict' | 'none'>('cookies.sameSite', 'lax'),
      path: '/',
      maxAge: this.refreshTokenMaxAge(),
    });
  }

  private clearRefreshCookie(res: Response): void {
    res.clearCookie(REFRESH_TOKEN_COOKIE, {
      httpOnly: true,
      secure: this.configService.get<boolean>('cookies.secure', false),
      sameSite: this.configService.get<'lax' | 'strict' | 'none'>('cookies.sameSite', 'lax'),
      path: '/',
    });
  }

  private refreshTokenMaxAge(): number {
    // Convert refresh token expiry (e.g. "7d") to milliseconds for the cookie.
    const expiresIn = this.configService.get<string>('jwt.refreshExpiresIn', '7d');
    return ms(expiresIn);
  }
}

function ms(value: string): number {
  const match = /^(\d+)\s*(ms|s|m|h|d|w|y)?$/i.exec(value.trim());
  if (!match) return 7 * 24 * 60 * 60 * 1000;

  const amount = parseInt(match[1], 10);
  const unit = (match[2] ?? 'ms').toLowerCase();

  const multipliers: Record<string, number> = {
    ms: 1,
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
    w: 7 * 24 * 60 * 60 * 1000,
    y: 365 * 24 * 60 * 60 * 1000,
  };

  return amount * (multipliers[unit] ?? 1);
}
