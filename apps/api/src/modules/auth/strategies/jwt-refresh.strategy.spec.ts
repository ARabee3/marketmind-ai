import { Request } from 'express';
import * as bcrypt from 'bcrypt';

import { JwtRefreshStrategy } from './jwt-refresh.strategy';

describe('JwtRefreshStrategy', () => {
  it('accepts a matching active refresh session and returns its id', async () => {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'user-1',
          email: 'owner@example.com',
          roles: ['OWNER'],
          refreshToken: null,
        }),
      },
      refreshSession: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'session-1', tokenHash: 'session-hash' },
        ]),
      },
    };
    const config = {
      getOrThrow: jest.fn().mockReturnValue('refresh-secret'),
    };
    const strategy = new JwtRefreshStrategy(config as never, prisma as never);
    jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);

    const result = await strategy.validate(
      { cookies: { refreshToken: 'raw-token' } } as unknown as Request,
      { sub: 'user-1', email: 'owner@example.com', roles: ['OWNER'] as never },
    );

    expect(result).toEqual({
      id: 'user-1',
      email: 'owner@example.com',
      roles: ['OWNER'],
      refreshSessionId: 'session-1',
    });
    expect(prisma.refreshSession.findMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        revokedAt: null,
        expiresAt: { gt: expect.any(Date) },
      },
      select: { id: true, tokenHash: true },
    });
  });

  it('keeps a legacy user refresh token valid during migration', async () => {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'user-1',
          email: 'owner@example.com',
          roles: ['OWNER'],
          refreshToken: 'legacy-hash',
        }),
      },
      refreshSession: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const config = { getOrThrow: jest.fn().mockReturnValue('refresh-secret') };
    const strategy = new JwtRefreshStrategy(config as never, prisma as never);
    jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);

    await expect(
      strategy.validate(
        { cookies: { refreshToken: 'raw-token' } } as unknown as Request,
        { sub: 'user-1', email: 'owner@example.com', roles: ['OWNER'] as never },
      ),
    ).resolves.toEqual({
      id: 'user-1',
      email: 'owner@example.com',
      roles: ['OWNER'],
    });
  });
});
