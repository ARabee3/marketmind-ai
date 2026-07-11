import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Logger,
  Post,
  Query,
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
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { AuthRateLimiterService } from './auth-rate-limiter.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { JwtRefreshGuard } from './guards/jwt-refresh.guard';
import { AuthenticatedUser } from './interfaces/jwt-payload.interface';
import { OAuthStateService } from './oauth-state.service';
import { GoogleOAuthClient } from './google-oauth.client';
import { OAuthAccountPolicyService } from './oauth-account-policy.service';
import { OAuthException } from './exceptions/oauth.exception';
import { MailDeliveryError } from '../mail/mail-delivery.error';

interface RequestWithUser extends Request {
  user: AuthenticatedUser;
}

export const REFRESH_TOKEN_COOKIE = 'refreshToken';
export const OAUTH_STATE_COOKIE = 'oauthState';

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
    private readonly authRateLimiter: AuthRateLimiterService,
    private readonly oauthState: OAuthStateService,
    private readonly googleOAuth: GoogleOAuthClient,
    private readonly oauthAccountPolicy: OAuthAccountPolicyService,
  ) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 5, ttl: 900000 } })
  async register(@Body() dto: RegisterDto): Promise<SafeUser> {
    const allowed = await this.authRateLimiter.checkLimit('register', dto.email);
    if (!allowed) {
      throw new HttpException(
        { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return this.authService.register(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 900000 } })
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponse> {
    const allowed = await this.authRateLimiter.checkLimit('login', dto.email);
    if (!allowed) {
      throw new HttpException(
        { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

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
  async getMe(@Req() req: RequestWithUser): Promise<{ user: SafeUser }> {
    const user = await this.authService.getMe(req.user.id);
    return { user };
  }

  @Get('google')
  @Throttle({ default: { limit: 10, ttl: 900000 } })
  async googleAuth(@Req() req: Request, @Res() res: Response): Promise<void> {
    const ip = req.ip ?? 'unknown';
    const allowed = await this.authRateLimiter.checkLimit('oauth-initiate', ip);
    if (!allowed) {
      throw new HttpException(
        { code: 'AUTH_RATE_LIMITED', message: 'Too many OAuth attempts' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const state = await this.oauthState.createState('google');
    this.setOAuthStateCookie(res, state);
    const url = this.googleOAuth.getAuthorizationUrl(state);
    res.redirect(url);
  }

  @Get('google/callback')
  async googleCallback(
    @Req() req: Request,
    @Res() res: Response,
    @Query('state') state?: string,
    @Query('code') code?: string,
    @Query('error') providerError?: string,
  ): Promise<void> {
    const ip = req.ip ?? 'unknown';
    const redirectBase = this.oauthRedirectUrl();
    const browserState = req.cookies?.[OAUTH_STATE_COOKIE];
    const browserStateMatches = Boolean(state && state === browserState);

    const allowed = await this.authRateLimiter.checkLimit('oauth-callback', ip);
    if (!allowed) {
      if (browserStateMatches) {
        this.clearOAuthStateCookie(res);
      }
      return this.redirectWithError(
        res,
        redirectBase,
        'AUTH_RATE_LIMITED',
      );
    }

    try {
      if (!browserStateMatches) {
        throw new OAuthException(
          'OAUTH_STATE_MISMATCH',
          'OAuth state does not match the initiating browser',
        );
      }

      await this.oauthState.consumeState(state);

      if (providerError) {
        throw new OAuthException(
          'OAUTH_PROVIDER_ERROR',
          'Google OAuth provider denied or cancelled the request',
        );
      }

      if (!code) {
        throw new OAuthException(
          'OAUTH_PROVIDER_ERROR',
          'Missing authorization code',
        );
      }

      const profile = await this.googleOAuth.exchangeCode(code);
      const result = await this.oauthAccountPolicy.signInWithGoogle(profile);

      this.setRefreshCookie(res, result.rawRefreshToken);
      this.clearOAuthStateCookie(res);
      res.redirect(`${redirectBase}?status=success`);
    } catch (error) {
      this.logger.warn('Google OAuth callback failed', error);
      const errorCode = this.normalizeOAuthError(error);
      if (browserStateMatches) {
        this.clearOAuthStateCookie(res);
      }
      this.redirectWithError(res, redirectBase, errorCode);
    }
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 3, ttl: 900000 } })
  async forgotPassword(@Body() dto: ForgotPasswordDto): Promise<{ message: string }> {
    const allowed = await this.authRateLimiter.checkLimit('password-reset', dto.email);
    if (!allowed) {
      throw new HttpException(
        { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    try {
      await this.authService.forgotPassword(dto.email);
    } catch (error) {
      if (error instanceof MailDeliveryError) {
        this.logger.warn(`Password reset mail delivery failed: ${error.message}`);
      }
    }

    return { message: 'If an account with that email exists, a password reset link has been sent' };
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 3, ttl: 900000 } })
  async resetPassword(@Body() dto: ResetPasswordDto): Promise<{ message: string }> {
    await this.authService.resetPassword(dto.token, dto.newPassword);
    return { message: 'Password has been reset successfully' };
  }

  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 3, ttl: 3600000 } })
  async verifyEmail(@Body() dto: VerifyEmailDto): Promise<{ message: string }> {
    const prefix = dto.token.substring(0, 8);
    const allowed = await this.authRateLimiter.checkLimit('verify-email', prefix);
    if (!allowed) {
      throw new HttpException(
        { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    await this.authService.verifyEmail(dto.token);
    return { message: 'Email verified successfully' };
  }

  @Post('resend-verification')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 3, ttl: 3600000 } })
  async resendVerification(@Req() req: RequestWithUser): Promise<{ message: string }> {
    const allowed = await this.authRateLimiter.checkLimit('verify-email', req.user.id);
    if (!allowed) {
      throw new HttpException(
        { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    try {
      await this.authService.sendVerificationEmail(req.user.id, req.user.email);
    } catch (error) {
      if (error instanceof MailDeliveryError) {
        throw new HttpException(
          { code: 'MAIL_DELIVERY_FAILED', message: 'Failed to send verification email' },
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }
      throw error;
    }

    return { message: 'Verification email sent' };
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

  private setOAuthStateCookie(res: Response, state: string): void {
    res.cookie(OAUTH_STATE_COOKIE, state, {
      httpOnly: true,
      secure: this.configService.get<boolean>('cookies.secure', false),
      sameSite: 'lax',
      path: '/',
      maxAge: 10 * 60 * 1000,
    });
  }

  private clearOAuthStateCookie(res: Response): void {
    res.clearCookie(OAUTH_STATE_COOKIE, {
      httpOnly: true,
      secure: this.configService.get<boolean>('cookies.secure', false),
      sameSite: 'lax',
      path: '/',
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
    const expiresIn = this.configService.get<string>('jwt.refreshExpiresIn', '7d');
    return ms(expiresIn);
  }

  private oauthRedirectUrl(): string {
    const origin = this.configService.get<string>('cors.origin') ?? 'http://localhost:3000';
    return `${origin.replace(/\/$/, '')}/oauth/callback`;
  }

  private redirectWithError(
    res: Response,
    base: string,
    code: string,
  ): void {
    const url = new URL(base);
    url.searchParams.set('error', code);
    res.redirect(url.toString());
  }

  private normalizeOAuthError(error: unknown): string {
    if (error instanceof OAuthException) {
      return error.code;
    }

    if (error instanceof HttpException) {
      const response = error.getResponse();
      if (typeof response === 'object' && response !== null && 'code' in response) {
        return (response as { code: string }).code;
      }
      return 'OAUTH_PROVIDER_ERROR';
    }

    return 'SERVER_ERROR';
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
