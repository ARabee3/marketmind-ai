import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';

import { AuthController, REFRESH_TOKEN_COOKIE } from './auth.controller';
import { AuthService, LoginResponse, RefreshResponse, SafeUser } from './auth.service';
import { AuthRateLimiterService } from './auth-rate-limiter.service';
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

  const mockAuthRateLimiter = {
    checkLimit: jest.fn().mockResolvedValue(true),
  };

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
      forgotPassword: jest.fn(),
      resetPassword: jest.fn(),
      verifyEmail: jest.fn(),
      sendVerificationEmail: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: authService },
        { provide: ConfigService, useValue: createMockConfigService() },
        { provide: AuthRateLimiterService, useValue: mockAuthRateLimiter },
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

  // =========================================================================
  // register — rate-limit gating
  // =========================================================================

  describe('register', () => {
    it('delegates to authService.register and returns safe user', async () => {
      authService.register!.mockResolvedValue(mockSafeUser);

      const result = await controller.register({ email: 'new@marketmind.ai', password: 'Password123!', fullName: 'New User' });

      expect(authService.register).toHaveBeenCalledWith({ email: 'new@marketmind.ai', password: 'Password123!', fullName: 'New User' });
      expect(result).toEqual(mockSafeUser);
    });

  });

  // =========================================================================
  // login — rate-limit gating
  // =========================================================================

  // =========================================================================
  // forgot-password
  // =========================================================================

  describe('forgot-password', () => {
    it('returns a generic success message regardless of whether the email exists', async () => {
      authService.forgotPassword!.mockResolvedValue(undefined);

      const result = await controller.forgotPassword({ email: 'anyone@example.com' });

      expect(result.message).toContain('If an account with that email exists');
      expect(authService.forgotPassword).toHaveBeenCalledWith('anyone@example.com');
    });


    it('still returns generic success when mail delivery fails', async () => {
      const { MailDeliveryError } = jest.requireActual('../mail/mail-delivery.error') as typeof import('../mail/mail-delivery.error');
      authService.forgotPassword!.mockRejectedValue(new MailDeliveryError('SMTP down'));

      const result = await controller.forgotPassword({ email: 'valid@example.com' });

      // Must NOT expose the delivery failure to the client
      expect(result.message).toContain('If an account with that email exists');
    });
  });

  // =========================================================================
  // reset-password
  // =========================================================================

  describe('reset-password', () => {
    it('delegates to authService.resetPassword and returns success', async () => {
      authService.resetPassword!.mockResolvedValue(undefined);

      const result = await controller.resetPassword({ token: 'valid-token', newPassword: 'NewPass456!' });

      expect(authService.resetPassword).toHaveBeenCalledWith('valid-token', 'NewPass456!');
      expect(result.message).toContain('Password has been reset');
    });
  });

  // =========================================================================
  // verify-email
  // =========================================================================

  describe('verify-email', () => {
    it('delegates to authService.verifyEmail and returns success', async () => {
      authService.verifyEmail!.mockResolvedValue(undefined);

      const result = await controller.verifyEmail({ token: 'abcdef1234567890' });

      expect(authService.verifyEmail).toHaveBeenCalledWith('abcdef1234567890');
      expect(result.message).toContain('Email verified');
    });

    it('returns 429 when per-token rate limit is exceeded', async () => {
      mockAuthRateLimiter.checkLimit.mockResolvedValueOnce(false);

      await expect(
        controller.verifyEmail({ token: 'abcdef1234567890' }),
      ).rejects.toThrow(expect.objectContaining({ status: 429 }));

      expect(authService.verifyEmail).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // resend-verification
  // =========================================================================

  describe('resend-verification', () => {
    const mockReq = {
      user: { id: 'uuid-1234', email: 'test@marketmind.ai', roles: [Role.OWNER] },
    } as never;

    it('delegates to authService.sendVerificationEmail and returns success', async () => {
      authService.sendVerificationEmail!.mockResolvedValue(undefined);

      const result = await controller.resendVerification(mockReq);

      expect(authService.sendVerificationEmail).toHaveBeenCalledWith('uuid-1234', 'test@marketmind.ai');
      expect(result.message).toContain('Verification email sent');
    });

    it('returns 429 when per-user rate limit is exceeded', async () => {
      mockAuthRateLimiter.checkLimit.mockResolvedValueOnce(false);

      await expect(controller.resendVerification(mockReq)).rejects.toThrow(
        expect.objectContaining({ status: 429 }),
      );

      expect(authService.sendVerificationEmail).not.toHaveBeenCalled();
    });

    it('returns 503 when mail delivery fails', async () => {
      const { MailDeliveryError } = jest.requireActual('../mail/mail-delivery.error') as typeof import('../mail/mail-delivery.error');
      authService.sendVerificationEmail!.mockRejectedValue(new MailDeliveryError('SMTP down'));

      await expect(controller.resendVerification(mockReq)).rejects.toThrow(
        expect.objectContaining({ status: 503 }),
      );
    });
  });
});
