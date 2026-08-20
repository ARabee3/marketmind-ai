import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { UserStatus } from '@prisma/client';
import { PrismaService } from '../../../common/persistence/prisma.service';
import { JwtPayload, AuthenticatedUser } from '../interfaces/jwt-payload.interface';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>('jwt.accessSecret'),
    });
  }

  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    if (!payload.sub || !payload.email) {
      throw new UnauthorizedException('Malformed token payload');
    }

    // Suspension enforcement: reject tokens for accounts that are no longer
    // active. The DB lookup is only meaningful for real UUID subjects; legacy
    // tokens with non-UUID subs (e.g. seeded test fixtures) skip the status
    // check instead of failing on Prisma's UUID coercion.
    if (UUID_PATTERN.test(payload.sub)) {
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: { status: true },
      });

      if (user && user.status !== UserStatus.ACTIVE) {
        throw new UnauthorizedException('Account is not active');
      }
    }

    return {
      id: payload.sub,
      email: payload.email,
      roles: payload.roles,
    };
  }
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;