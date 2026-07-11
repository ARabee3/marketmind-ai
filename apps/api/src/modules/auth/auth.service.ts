
import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Prisma, Role, User } from '@prisma/client';
import * as bcrypt from 'bcrypt';

import { PrismaService } from '../../common/persistence/prisma.service';
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
  ) {}


  /**
   * Creates a new user account.
   *
   * - Normalises the email (lowercase + trim) before uniqueness check.
   * - Hashes the password with bcrypt before persistence.
   * - Returns the safe user profile; never returns the password hash.
   *
   * @throws ConflictException  if the email is already registered.
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

    try {
      const user = await this.prisma.user.create({
        data: {
          email: dto.email,
          password: hashedPassword,
          fullName: dto.fullName,
        },
      });

      this.logger.log(`New user registered: ${user.id}`);
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
   *
   * The raw refresh token is returned separately so the controller can send it
   * as an HttpOnly cookie; it must never be included in the JSON response body.
   *
   * @throws UnauthorizedException on any credential mismatch.
   */
  async login(dto: LoginDto): Promise<LoginResponse & TokenPair> {
    // 1. Look up the user.
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    // 2. Validate password — even if user is null we still call bcrypt.compare
    //    with a dummy hash so the response time is indistinguishable from a
    //    real failure, defeating timing-based user enumeration.
    const DUMMY_HASH = '$2b$12$invalidhashfortimingattackprevention00000000000000000000';
    const passwordToCheck = user?.password ?? DUMMY_HASH;
    const passwordMatches = await bcrypt.compare(dto.password, passwordToCheck);

    if (!user || !passwordMatches) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // 3. Issue tokens.
    const tokens = await this.generateTokens(user.id, user.email, user.roles);

    // 4. Persist the hashed refresh token and update lastLoginAt atomically.
    await this.updateRefreshTokenHash(user.id, tokens.rawRefreshToken, {
      lastLoginAt: new Date(),
    });

    this.logger.log(`User logged in: ${user.id}`);
    return {
      accessToken: tokens.accessToken,
      rawRefreshToken: tokens.rawRefreshToken,
      user: this.toSafeUser(user),
    };
  }

  /**
   * Issues a new token pair (token rotation).
   *
   * The raw refresh token and database hash comparison has already been
   * performed by JwtRefreshStrategy.validate() before this method is called.
   * Here we only generate new tokens and update the DB.
   *
   * The raw refresh token is returned separately so the controller can send it
   * as an HttpOnly cookie; it must never be included in the JSON response body.
   *
   * @param user - The AuthenticatedUser populated by JwtRefreshStrategy.
   */
  async refresh(user: AuthenticatedUser): Promise<TokenPair> {
    const tokens = await this.generateTokens(user.id, user.email, user.roles);
    await this.updateRefreshTokenHash(user.id, tokens.rawRefreshToken);
    this.logger.log(`Tokens rotated for user: ${user.id}`);
    return tokens;
  }

  /**
   * Issues a token pair for an already-verified user.
   *
   * Used by OAuth flows after the provider profile has been validated and
   * the local user account has been located or created.
   */
  async issueTokensForUser(
    user: Pick<
      User,
      | "id"
      | "email"
      | "roles"
      | "fullName"
      | "isEmailVerified"
      | "lastLoginAt"
      | "createdAt"
      | "updatedAt"
    >,
  ): Promise<LoginResponse & TokenPair> {
    const tokens = await this.generateTokens(user.id, user.email, user.roles);

    await this.updateRefreshTokenHash(user.id, tokens.rawRefreshToken, {
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
    await this.prisma.user.updateMany({
      where: {
        id: userId,
        refreshToken: { not: null },
      },
      data: { refreshToken: null },
    });

    this.logger.log(`User logged out: ${userId}`);
  }

  async getMe(userId: string): Promise<SafeUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
    throw new UnauthorizedException('User no longer exists');
    }

    return this.toSafeUser(user);
  }

  private async generateTokens(
    userId: string,
    email: string,
    roles: Role[],
  ): Promise<TokenPair> {
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

 
  private async updateRefreshTokenHash(
    userId: string,
    rawRefreshToken: string,
    additionalData: Partial<Pick<Prisma.UserUpdateInput, 'lastLoginAt'>> = {},
  ): Promise<void> {
    const hashed = await bcrypt.hash(rawRefreshToken, 10);
    await this.prisma.user.update({
      where: { id: userId },
      data: { refreshToken: hashed, ...additionalData },
    });
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