// src/modules/auth/guards/jwt-auth.guard.ts

import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Protects routes with the ACCESS TOKEN strategy ('jwt').
 *
 * Usage:  @UseGuards(JwtAuthGuard)
 *
 * On success:  req.user is populated with AuthenticatedUser.
 * On failure:  throws 401 UnauthorizedException automatically.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}