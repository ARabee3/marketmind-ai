
import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Protects routes with the REFRESH TOKEN strategy ('jwt-refresh').
 *
 * Usage:  @UseGuards(JwtRefreshGuard)
 *
 * This guard additionally performs the DB hash comparison inside the
 * strategy's validate() method — it is NOT purely stateless.
 */
@Injectable()
export class JwtRefreshGuard extends AuthGuard('jwt-refresh') {}