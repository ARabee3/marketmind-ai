import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { ActionTokenType, Prisma, Role, User, UserStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';

import { PrismaService } from '../../common/persistence/prisma.service';
import { MailService } from '../mail/mail.service';
import { MailDeliveryError } from '../mail/mail-delivery.error';
import {
  renderVerifyEmail,
  renderResetPassword,
  normalizeLocale,
  type MailLocale,
} from '../mail/mail-templates';
import { ActionTokenService, ActionTokenError } from './action-token.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { JwtPayload, AuthenticatedUser } from './interfaces/jwt-payload.interface';

/** Public login response — refresh token is sent as HttpOnly cookie, never in body. */
export interface LoginResponse {
  accessToken: string;
  user: SafeUser;
}

/** Public refresh response — refresh token is sent as HttpOnly cookie, never in body. */
export interface RefreshResponse {
  accessToken: string;
}

/** Internal token pair used by the controller to set the refresh cookie. */
export interface TokenPair {
  accessToken: string;
  rawRefreshToken: string;
}

export interface RefreshSessionMetadata {
  userAgent?: string | null;
  ipAddress?: string | null;
}

/** Safe user representation — never contains password or refreshToken. */
export interface SafeUser {
  id: string;
  email: string;
  fullName: string | null;
  roles: Role[];
  isEmailVerified: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const BCRYPT_ROUNDS = 12;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly actionTokenService: ActionTokenService,
    private readonly mailService: MailService,
  ) {}

  /**
   * Creates a new user account.
   *
   * - Normalises the email (lowercase + trim) before uniqueness check.
   * - Hashes the password with bcrypt before persistence.
   * - Returns the safe user profile; never returns the password hash.
   *
   * @throws ConflictException if the email is already registered.
   */
  async register(dto: RegisterDto): Promise<SafeUser> {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
      select: { id: true },
    });

    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }

    const hashedPassword = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);

    const locale: MailLocale = normalizeLocale(dto.locale);

    try {
      const user = await this.prisma.user.create({
        data: {
          email: dto.email,
          password: hashedPassword,
          fullName: dto.fullName,
          preferredLocale: locale,
        },
      });

      this.logger.log(`New user registered: ${user.id}`);

      try {
        await this.sendVerificationEmail(user.id, user.email, locale);
      } catch (error) {
        this.logger.warn(`Verification email failed for user ${user.id}: ${error}`);
      }

      return this.toSafeUser(user);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('An account with this email already exists');
      }
      this.logger.error('Unexpected error during registration', error);
      throw new InternalServerErrorException('Registration failed');
    }
  }

  /**
   * Validates credentials and issues a token pair.
   *
   * Uses a generic "Invalid credentials" error for BOTH "user not found"
   * and "wrong password" cases to prevent user enumeration attacks.
   */
  async login(
    dto: LoginDto,
    sessionMetadata: RefreshSessionMetadata = {},
  ): Promise<LoginResponse & TokenPair> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    const DUMMY_HASH = '$2b$12$invalidhashfortimingattackprevention00000000000000000000';
    const passwordToCheck = user?.password ?? DUMMY_HASH;
    const passwordMatches = await bcrypt.compare(dto.password, passwordToCheck);

    if (!user || !passwordMatches) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.isEmailVerified) {
      throw new UnauthorizedException({
        code: 'EMAIL_NOT_VERIFIED',
        message: 'Please verify your email before logging in',
      });
    }

    if (user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException({
        code: 'ACCOUNT_SUSPENDED',
        message: 'Your account is not active. Contact support if you believe this is a mistake',
      });
    }

    const tokens = await this.generateTokens(user.id, user.email, user.roles);
    await this.persistRefreshSession(user.id, tokens.rawRefreshToken, sessionMetadata, {
      lastLoginAt: new Date(),
    });

    this.logger.log(`User logged in: ${user.id}`);
    return {
      accessToken: tokens.accessToken,
      rawRefreshToken: tokens.rawRefreshToken,
      user: this.toSafeUser(user),
    };
  }

  /** Issues a new token pair using refresh-token rotation. */
  async refresh(
    user: AuthenticatedUser,
    sessionMetadata: RefreshSessionMetadata = {},
  ): Promise<TokenPair> {
    const tokens = await this.generateTokens(user.id, user.email, user.roles);
    await this.persistRefreshSession(
      user.id,
      tokens.rawRefreshToken,
      sessionMetadata,
      {},
      user.refreshSessionId,
    );
    this.logger.log(`Tokens rotated for user: ${user.id}`);
    return tokens;
  }

  /** Issues tokens for an already-verified local user after OAuth sign-in. */
  async issueTokensForUser(
    user: Pick<
      User,
      | 'id'
      | 'email'
      | 'roles'
      | 'fullName'
      | 'isEmailVerified'
      | 'lastLoginAt'
      | 'createdAt'
      | 'updatedAt'
    >,
    sessionMetadata: RefreshSessionMetadata = {},
  ): Promise<LoginResponse & TokenPair> {
    const tokens = await this.generateTokens(user.id, user.email, user.roles);
    await this.persistRefreshSession(user.id, tokens.rawRefreshToken, sessionMetadata, {
      lastLoginAt: new Date(),
    });

    this.logger.log(`Tokens issued for user: ${user.id}`);
    return {
      accessToken: tokens.accessToken,
      rawRefreshToken: tokens.rawRefreshToken,
      user: this.toSafeUser(user),
    };
  }

  async logout(userId: string): Promise<void> {
    const revokedAt = new Date();
    await Promise.all([
      this.prisma.user.updateMany({
        where: { id: userId, refreshToken: { not: null } },
        data: { refreshToken: null },
      }),
      this.prisma.refreshSession.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt },
      }),
    ]);

    this.logger.log(`User logged out: ${userId}`);
  }

  async getMe(userId: string): Promise<SafeUser> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    if (!user) {
      throw new UnauthorizedException('User no longer exists');
    }

    return this.toSafeUser(user);
  }

  async sendVerificationEmail(
    userId: string,
    email: string,
    locale: MailLocale = 'en',
  ): Promise<void> {
    const { rawToken } = await this.actionTokenService.issue(
      userId,
      ActionTokenType.EMAIL_VERIFICATION,
    );

    const appUrl = this.configService.get<string>('mail.appUrl') ?? 'http://localhost:3000';
    const link = `${appUrl}/verify-email?token=${rawToken}`;
    const { subject, html } = renderVerifyEmail({ link, appUrl }, locale);

    await this.mailService.sendMail(email, subject, html);

    this.logger.log(`Verification email sent to user ${userId}`);
  }

  /**
   * Re-issues a verification link for an unverified user identified by email.
   *
   * Used by unauthenticated users who lost or expired their original link:
   * login refuses to issue tokens to unverified accounts, so this public path
   * is the only recovery route. Returns silently (no-op) when the email is
   * unknown or already verified, to prevent user enumeration (mirrors
   * `forgotPassword`). Issuing a new token invalidates any prior unconsumed
   * verification token for the user (see `ActionTokenService.issue`).
   */
  async resendVerificationByEmail(email: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, isEmailVerified: true, preferredLocale: true },
    });

    if (!user || user.isEmailVerified) {
      this.logger.warn(
        `Verification resend requested for ${user ? 'already-verified' : 'unknown'} email: ${email}`,
      );
      return;
    }

    await this.sendVerificationEmail(
      user.id,
      user.email,
      normalizeLocale(user.preferredLocale),
    );
  }

  async forgotPassword(email: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, preferredLocale: true },
    });

    if (!user) {
      this.logger.warn(`Password reset requested for unknown email: ${email}`);
      return;
    }

    const locale = normalizeLocale(user.preferredLocale);
    const { rawToken } = await this.actionTokenService.issue(
      user.id,
      ActionTokenType.PASSWORD_RESET,
    );
    const appUrl = this.configService.get<string>('mail.appUrl') ?? 'http://localhost:3000';
    const link = `${appUrl}/reset-password?token=${rawToken}`;
    const { subject, html } = renderResetPassword({ link, appUrl }, locale);

    await this.mailService.sendMail(user.email, subject, html);

    this.logger.log(`Password reset email sent to user ${user.id}`);
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    let userId: string;

    try {
      userId = await this.actionTokenService.consume(token, ActionTokenType.PASSWORD_RESET);
    } catch (error) {
      if (error instanceof ActionTokenError) {
        throw new UnprocessableEntityException({ code: error.code, message: error.message });
      }
      throw error;
    }

    const hashedPassword = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { password: hashedPassword, refreshToken: null },
      }),
      this.prisma.refreshSession.deleteMany({ where: { userId } }),
    ]);

    this.logger.log(`Password reset for user ${userId}`);
  }

  async verifyEmail(token: string): Promise<void> {
    let userId: string;

    try {
      userId = await this.actionTokenService.consume(token, ActionTokenType.EMAIL_VERIFICATION);
    } catch (error) {
      if (error instanceof ActionTokenError) {
        throw new UnprocessableEntityException({ code: error.code, message: error.message });
      }
      throw error;
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { isEmailVerified: true },
    });

    this.logger.log(`Email verified for user ${userId}`);
  }

  private async generateTokens(userId: string, email: string, roles: Role[]): Promise<TokenPair> {
    const payload: JwtPayload = { sub: userId, email, roles };
    const accessOptions: JwtSignOptions = {
      secret: this.configService.getOrThrow<string>('jwt.accessSecret'),
      expiresIn: this.configService.get<string>('jwt.accessExpiresIn') as JwtSignOptions['expiresIn'],
    };
    const refreshOptions: JwtSignOptions = {
      secret: this.configService.getOrThrow<string>('jwt.refreshSecret'),
      expiresIn: this.configService.get<string>('jwt.refreshExpiresIn') as JwtSignOptions['expiresIn'],
    };

    const [accessToken, rawRefreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, accessOptions),
      this.jwtService.signAsync(payload, refreshOptions),
    ]);

    return { accessToken, rawRefreshToken };
  }

  private async persistRefreshSession(
    userId: string,
    rawRefreshToken: string,
    sessionMetadata: RefreshSessionMetadata = {},
    additionalData: Partial<Pick<Prisma.UserUpdateInput, 'lastLoginAt'>> = {},
    previousSessionId?: string,
  ): Promise<void> {
    const tokenHash = await bcrypt.hash(rawRefreshToken, 10);
    const operations: Prisma.PrismaPromise<unknown>[] = [
      this.prisma.user.update({
        where: { id: userId },
        data: { refreshToken: tokenHash, ...additionalData },
      }),
      this.prisma.refreshSession.create({
        data: {
          userId,
          tokenHash,
          userAgent: sessionMetadata.userAgent ?? null,
          ipAddress: sessionMetadata.ipAddress ?? null,
          expiresAt: this.refreshSessionExpiresAt(),
        },
      }),
    ];

    if (previousSessionId) {
      operations.push(
        this.prisma.refreshSession.update({
          where: { id: previousSessionId },
          data: { revokedAt: new Date() },
        }),
      );
    }

    await this.prisma.$transaction(operations);
  }

  private refreshSessionExpiresAt(): Date {
    const expiresIn = this.configService.get<string>('jwt.refreshExpiresIn', '7d');
    return new Date(Date.now() + parseDurationMs(expiresIn));
  }

  private toSafeUser(user: {
    id: string;
    email: string;
    fullName: string | null;
    roles: Role[];
    isEmailVerified: boolean;
    lastLoginAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    password?: string;
    refreshToken?: string | null;
  }): SafeUser {
    const { password: _password, refreshToken: _rt, ...safe } = user;
    return safe;
  }
}

function parseDurationMs(value: string): number {
  const match = /^(\d+)\s*(ms|s|m|h|d|w|y)?$/i.exec(value.trim());
  if (!match) return 7 * 24 * 60 * 60 * 1000;

  const amount = Number.parseInt(match[1], 10);
  const multipliers: Record<string, number> = {
    ms: 1,
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
    w: 7 * 24 * 60 * 60 * 1000,
    y: 365 * 24 * 60 * 60 * 1000,
  };

  return amount * (multipliers[(match[2] ?? 'ms').toLowerCase()] ?? 1);
}
