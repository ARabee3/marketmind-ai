
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-jwt';
import { Request } from 'express';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../../common/persistence/prisma.service';
import { JwtPayload, AuthenticatedUser } from '../interfaces/jwt-payload.interface';
import { REFRESH_TOKEN_COOKIE } from '../auth.controller';

function extractRefreshTokenFromCookie(req: Request): string | undefined {
  return req.cookies?.[REFRESH_TOKEN_COOKIE];
}

@Injectable()
export class JwtRefreshStrategy extends PassportStrategy(Strategy, 'jwt-refresh') {
  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: extractRefreshTokenFromCookie,
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>('jwt.refreshSecret'),
      passReqToCallback: true,
    });
  }

  /**
   * @param req     - Raw Express request (needed to extract the raw token string from the HttpOnly cookie).
   * @param payload - Decoded & verified JWT payload.
   */
  async validate(req: Request, payload: JwtPayload): Promise<AuthenticatedUser> {
    const rawRefreshToken = extractRefreshTokenFromCookie(req);
    if (!rawRefreshToken) {
      throw new UnauthorizedException('Missing refresh token');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        roles: true,
        refreshToken: true,
      },
    });

    if (!user || !user.refreshToken) {
      throw new UnauthorizedException('Access denied');
    }

    const tokenMatches = await bcrypt.compare(rawRefreshToken, user.refreshToken);
    if (!tokenMatches) {
      throw new UnauthorizedException('Access denied');
    }

    return {
      id: user.id,
      email: user.email,
      roles: user.roles,
    };
  }
}