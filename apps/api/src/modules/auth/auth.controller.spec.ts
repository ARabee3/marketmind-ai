import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';

import { AuthController, REFRESH_TOKEN_COOKIE } from './auth.controller';
import { AuthService, LoginResponse, RefreshResponse, SafeUser } from './auth.service';
import { Role } from '@prisma/client';

const mockSafeUser: SafeUser = {
  id: 'uuid-1234',
  email: 'test@marketmind.ai',
  fullName: 'Test Owner',
  roles: [Role.OWNER],
  isEmailVerified: false,
  lastLoginAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('AuthController', () => {
  let controller: AuthController;
  let authService: jest.Mocked<Partial<AuthService>>;
  let response: Response;
  let cookies: Record<string, { value: string; options: Record<string, unknown> }>;

  const createMockConfigService = () => ({
    get: jest.fn((key: string) => {
      const map: Record<string, unknown> = {
        'cookies.secure': true,
        'cookies.sameSite': 'lax',
        'jwt.refreshExpiresIn': '7d',
      };
      return map[key];
    }),
    getOrThrow: jest.fn(),
  });

  beforeEach(async () => {
    cookies = {};
    response = {
      cookie: jest.fn((name: string, value: string, options: Record<string, unknown>) => {
        cookies[name] = { value, options };
      }),
      clearCookie: jest.fn((name: string, options: Record<string, unknown>) => {
        cookies[name] = { value: '', options: { ...options, maxAge: 0 } };
      }),
    } as unknown as Response;

    authService = {
      login: jest.fn(),
      refresh: jest.fn(),
      logout: jest.fn(),
      register: jest.fn(),
      getMe: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: authService },
        { provide: ConfigService, useValue: createMockConfigService() },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  describe('login', () => {
    it('sets an HttpOnly SameSite=Lax Secure Path=/ refresh token cookie and returns accessToken + user', async () => {
      authService.login.mockResolvedValue({
        accessToken: 'access-token',
        rawRefreshToken: 'raw-refresh-token',
        user: mockSafeUser,
      });

      const result = await controller.login(
        { email: 'test@marketmind.ai', password: 'Password123!' },
        response,
      );

      expect(result).toEqual({ accessToken: 'access-token', user: mockSafeUser });
      expect(result).not.toHaveProperty('refreshToken');

      expect(cookies[REFRESH_TOKEN_COOKIE]).toBeDefined();
      expect(cookies[REFRESH_TOKEN_COOKIE].value).toBe('raw-refresh-token');
      expect(cookies[REFRESH_TOKEN_COOKIE].options).toMatchObject({
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        path: '/',
      });
    });
  });

  describe('refresh', () => {
    it('sets a rotated HttpOnly refresh cookie and returns only accessToken', async () => {
      authService.refresh.mockResolvedValue({
        accessToken: 'new-access-token',
        rawRefreshToken: 'new-raw-refresh-token',
      });

      const result = await controller.refresh(
        { user: { id: 'uuid-1234', email: 'test@marketmind.ai', roles: [Role.OWNER] } } as never,
        response,
      );

      expect(result).toEqual({ accessToken: 'new-access-token' });
      expect(result).not.toHaveProperty('refreshToken');
      expect(cookies[REFRESH_TOKEN_COOKIE].value).toBe('new-raw-refresh-token');
    });
  });

  describe('logout', () => {
    it('clears the refresh token cookie and logs the user out', async () => {
      authService.logout.mockResolvedValue(undefined);

      await controller.logout(
        { user: { id: 'uuid-1234', email: 'test@marketmind.ai', roles: [Role.OWNER] } } as never,
        response,
      );

      expect(authService.logout).toHaveBeenCalledWith('uuid-1234');
      expect(cookies[REFRESH_TOKEN_COOKIE]).toBeDefined();
      expect(cookies[REFRESH_TOKEN_COOKIE].options.maxAge).toBe(0);
    });
  });
});
