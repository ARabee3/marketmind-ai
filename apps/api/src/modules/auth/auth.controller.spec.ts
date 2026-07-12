import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';

import {
  AuthController,
  OAUTH_STATE_COOKIE,
  REFRESH_TOKEN_COOKIE,
} from './auth.controller';
import { AuthService, SafeUser } from './auth.service';
import { AuthRateLimiterService } from './auth-rate-limiter.service';
import { OAuthStateService } from './oauth-state.service';
import { GoogleOAuthClient } from './google-oauth.client';
import { OAuthAccountPolicyService } from './oauth-account-policy.service';
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
  let rateLimiter: ReturnType<typeof createMockRateLimiter>;
  let oauthState: ReturnType<typeof createMockOAuthState>;
  let googleOAuth: ReturnType<typeof createMockGoogleOAuth>;
  let oauthAccountPolicy: ReturnType<typeof createMockOAuthAccountPolicy>;
  let response: Response;
  let cookies: Record<string, { value: string; options: Record<string, unknown> }>;

  const createMockConfigService = () => ({
    get: jest.fn((key: string) => {
      const map: Record<string, unknown> = {
        'cookies.secure': true,
        'cookies.sameSite': 'lax',
        'jwt.refreshExpiresIn': '7d',
        'cors.origin': 'http://localhost:3000',
      };
      return map[key];
    }),
    getOrThrow: jest.fn(),
  });

  const createMockRateLimiter = () => ({
    checkLimit: jest.fn().mockResolvedValue(true),
  });

  const createMockOAuthState = () => ({
    createState: jest.fn(),
    consumeState: jest.fn(),
  });

  const createMockGoogleOAuth = () => ({
    getAuthorizationUrl: jest.fn(),
    exchangeCode: jest.fn(),
  });

  const createMockOAuthAccountPolicy = () => ({
    signInWithGoogle: jest.fn(),
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
      redirect: jest.fn(),
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
      resendVerificationByEmail: jest.fn(),
    };

    rateLimiter = createMockRateLimiter();
    oauthState = createMockOAuthState();
    googleOAuth = createMockGoogleOAuth();
    oauthAccountPolicy = createMockOAuthAccountPolicy();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: authService },
        { provide: ConfigService, useValue: createMockConfigService() },
        { provide: AuthRateLimiterService, useValue: rateLimiter },
        { provide: OAuthStateService, useValue: oauthState },
        { provide: GoogleOAuthClient, useValue: googleOAuth },
        { provide: OAuthAccountPolicyService, useValue: oauthAccountPolicy },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  describe('login', () => {
    it('sets an HttpOnly SameSite=Lax Secure Path=/ refresh token cookie and returns accessToken + user', async () => {
      authService.login!.mockResolvedValue({
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
      authService.refresh!.mockResolvedValue({
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
      authService.logout!.mockResolvedValue(undefined);

      await controller.logout(
        { user: { id: 'uuid-1234', email: 'test@marketmind.ai', roles: [Role.OWNER] } } as never,
        response,
      );

      expect(authService.logout).toHaveBeenCalledWith('uuid-1234');
      expect(cookies[REFRESH_TOKEN_COOKIE]).toBeDefined();
      expect(cookies[REFRESH_TOKEN_COOKIE].options.maxAge).toBe(0);
    });
  });

  describe('register', () => {
    it('delegates to authService.register and returns safe user', async () => {
      authService.register!.mockResolvedValue(mockSafeUser);

      const result = await controller.register({
        email: 'new@marketmind.ai',
        password: 'Password123!',
        fullName: 'New User',
      });

      expect(authService.register).toHaveBeenCalledWith({
        email: 'new@marketmind.ai',
        password: 'Password123!',
        fullName: 'New User',
      });
      expect(result).toEqual(mockSafeUser);
    });

    it('returns 429 when per-email rate limit is exceeded', async () => {
      rateLimiter.checkLimit.mockResolvedValueOnce(false);

      await expect(
        controller.register({ email: 'spam@marketmind.ai', password: 'Password123!', fullName: 'Spam' }),
      ).rejects.toThrow(expect.objectContaining({ status: 429 }));

      expect(authService.register).not.toHaveBeenCalled();
    });
  });

  describe('login — rate limit', () => {
    it('returns 429 when per-email rate limit is exceeded', async () => {
      rateLimiter.checkLimit.mockResolvedValueOnce(false);

      await expect(
        controller.login({ email: 'test@marketmind.ai', password: 'Password123!' }, response),
      ).rejects.toThrow(expect.objectContaining({ status: 429 }));

      expect(authService.login).not.toHaveBeenCalled();
    });
  });

  describe('forgot-password', () => {
    it('returns a generic success message regardless of whether the email exists', async () => {
      authService.forgotPassword!.mockResolvedValue(undefined);

      const result = await controller.forgotPassword({ email: 'anyone@example.com' });

      expect(result.message).toContain('If an account with that email exists');
      expect(authService.forgotPassword).toHaveBeenCalledWith('anyone@example.com');
    });

    it('returns 429 when per-email rate limit is exceeded', async () => {
      rateLimiter.checkLimit.mockResolvedValueOnce(false);

      await expect(controller.forgotPassword({ email: 'spam@example.com' })).rejects.toThrow(
        expect.objectContaining({ status: 429 }),
      );

      expect(authService.forgotPassword).not.toHaveBeenCalled();
    });

    it('still returns generic success when mail delivery fails', async () => {
      const { MailDeliveryError } = jest.requireActual('../mail/mail-delivery.error') as typeof import('../mail/mail-delivery.error');
      authService.forgotPassword!.mockRejectedValue(new MailDeliveryError('SMTP down'));

      const result = await controller.forgotPassword({ email: 'valid@example.com' });

      expect(result.message).toContain('If an account with that email exists');
    });
  });

  describe('reset-password', () => {
    it('delegates to authService.resetPassword and returns success', async () => {
      authService.resetPassword!.mockResolvedValue(undefined);

      const result = await controller.resetPassword({ token: 'valid-token', newPassword: 'NewPass456!' });

      expect(authService.resetPassword).toHaveBeenCalledWith('valid-token', 'NewPass456!');
      expect(result.message).toContain('Password has been reset');
    });
  });

  describe('verify-email', () => {
    it('delegates to authService.verifyEmail and returns success', async () => {
      authService.verifyEmail!.mockResolvedValue(undefined);

      const result = await controller.verifyEmail({ token: 'abcdef1234567890' });

      expect(authService.verifyEmail).toHaveBeenCalledWith('abcdef1234567890');
      expect(result.message).toContain('Email verified');
    });

    it('returns 429 when per-token rate limit is exceeded', async () => {
      rateLimiter.checkLimit.mockResolvedValueOnce(false);

      await expect(controller.verifyEmail({ token: 'abcdef1234567890' })).rejects.toThrow(
        expect.objectContaining({ status: 429 }),
      );

      expect(authService.verifyEmail).not.toHaveBeenCalled();
    });
  });

  describe('resend-verification', () => {
    it('delegates to authService.resendVerificationByEmail and returns generic success', async () => {
      authService.resendVerificationByEmail!.mockResolvedValue(undefined);

      const result = await controller.resendVerification({ email: 'someone@example.com' });

      expect(authService.resendVerificationByEmail).toHaveBeenCalledWith('someone@example.com');
      expect(result.message).toContain('verification link has been sent');
    });

    it('returns 429 when per-email rate limit is exceeded', async () => {
      rateLimiter.checkLimit.mockResolvedValueOnce(false);

      await expect(
        controller.resendVerification({ email: 'spam@example.com' }),
      ).rejects.toThrow(expect.objectContaining({ status: 429 }));

      expect(authService.resendVerificationByEmail).not.toHaveBeenCalled();
    });

    it('still returns generic success when mail delivery fails (anti-enumeration)', async () => {
      const { MailDeliveryError } = jest.requireActual('../mail/mail-delivery.error') as typeof import('../mail/mail-delivery.error');
      authService.resendVerificationByEmail!.mockRejectedValue(new MailDeliveryError('SMTP down'));

      const result = await controller.resendVerification({ email: 'valid@example.com' });

      expect(result.message).toContain('verification link has been sent');
    });
  });

  describe('googleAuth', () => {
    const mockRequest = { ip: '127.0.0.1' } as Request;

    it('redirects to the Google authorization URL when rate limit allows', async () => {
      rateLimiter.checkLimit.mockResolvedValue(true);
      oauthState.createState.mockResolvedValue('state-nonce');
      googleOAuth.getAuthorizationUrl.mockReturnValue(
        'https://accounts.google.com/o/oauth2/v2/auth?state=state-nonce',
      );

      await controller.googleAuth(mockRequest, response);

      expect(rateLimiter.checkLimit).toHaveBeenCalledWith('oauth-initiate', '127.0.0.1');
      expect(oauthState.createState).toHaveBeenCalledWith('google');
      expect(cookies[OAUTH_STATE_COOKIE]).toMatchObject({
        value: 'state-nonce',
        options: expect.objectContaining({
          httpOnly: true,
          sameSite: 'lax',
          path: '/',
        }),
      });
      expect(googleOAuth.getAuthorizationUrl).toHaveBeenCalledWith('state-nonce');
      expect(response.redirect).toHaveBeenCalledWith(
        'https://accounts.google.com/o/oauth2/v2/auth?state=state-nonce',
      );
    });

    it('throws 429 when OAuth initiation is rate limited', async () => {
      rateLimiter.checkLimit.mockResolvedValue(false);

      await expect(controller.googleAuth(mockRequest, response)).rejects.toMatchObject({
        status: 429,
        response: { code: 'AUTH_RATE_LIMITED' },
      });
    });
  });

  describe('googleCallback', () => {
    const mockRequest = {
      ip: '127.0.0.1',
      cookies: { [OAUTH_STATE_COOKIE]: 'state-nonce' },
    } as unknown as Request;

    beforeEach(() => {
      rateLimiter.checkLimit.mockResolvedValue(true);
    });

    it('sets refresh cookie and redirects to success on valid callback', async () => {
      oauthState.consumeState.mockResolvedValue({ provider: 'google' });
      googleOAuth.exchangeCode.mockResolvedValue({
        providerSubject: 'google-sub-123',
        email: 'owner@example.com',
        emailVerified: true,
        rawProfile: {},
      });
      oauthAccountPolicy.signInWithGoogle.mockResolvedValue({
        user: mockSafeUser,
        isNew: true,
        accessToken: 'access-token',
        rawRefreshToken: 'raw-refresh-token',
      });

      await controller.googleCallback(mockRequest, response, 'state-nonce', 'auth-code');

      expect(oauthState.consumeState).toHaveBeenCalledWith('state-nonce');
      expect(googleOAuth.exchangeCode).toHaveBeenCalledWith('auth-code');
      expect(cookies[REFRESH_TOKEN_COOKIE].value).toBe('raw-refresh-token');
      expect(response.redirect).toHaveBeenCalledWith(
        'http://localhost:3000/oauth/callback?status=success',
      );
    });

    it('redirects with error and clears the cookie when matching state is expired', async () => {
      const { OAuthException } = await import('./exceptions/oauth.exception');
      oauthState.consumeState.mockRejectedValue(new OAuthException('OAUTH_STATE_MISMATCH', 'Invalid state'));

      await controller.googleCallback(mockRequest, response, 'state-nonce', 'auth-code');

      const redirectUrl = (response.redirect as jest.Mock).mock.calls[0][0];
      expect(redirectUrl).toContain('error=OAUTH_STATE_MISMATCH');
      expect(redirectUrl).not.toContain('message=');
      expect(response.clearCookie).toHaveBeenCalledWith(
        OAUTH_STATE_COOKIE,
        expect.objectContaining({ path: '/', sameSite: 'lax' }),
      );
    });

    it('rejects a callback whose state does not match the initiating browser cookie', async () => {
      await controller.googleCallback(mockRequest, response, 'different-state', 'auth-code');

      const redirectUrl = (response.redirect as jest.Mock).mock.calls[0][0];
      expect(redirectUrl).toContain('error=OAUTH_STATE_MISMATCH');
      expect(oauthState.consumeState).not.toHaveBeenCalled();
      expect(googleOAuth.exchangeCode).not.toHaveBeenCalled();
      expect(response.clearCookie).not.toHaveBeenCalled();
    });

    it('redirects with error when Google returns an error query param', async () => {
      await controller.googleCallback(mockRequest, response, 'state-nonce', undefined, 'access_denied');

      const redirectUrl = (response.redirect as jest.Mock).mock.calls[0][0];
      expect(redirectUrl).toContain('error=OAUTH_PROVIDER_ERROR');
      expect(redirectUrl).not.toContain('access_denied');
      expect(oauthState.consumeState).toHaveBeenCalledWith('state-nonce');
      expect(response.clearCookie).toHaveBeenCalledWith(
        OAUTH_STATE_COOKIE,
        expect.objectContaining({ path: '/', sameSite: 'lax' }),
      );
    });

    it('redirects with error for same-email password conflict', async () => {
      const { OAuthException } = await import('./exceptions/oauth.exception');
      oauthState.consumeState.mockResolvedValue({ provider: 'google' });
      googleOAuth.exchangeCode.mockResolvedValue({
        providerSubject: 'google-sub-123',
        email: 'owner@example.com',
        emailVerified: true,
        rawProfile: {},
      });
      oauthAccountPolicy.signInWithGoogle.mockRejectedValue(
        new OAuthException('OAUTH_EMAIL_ALREADY_USED_PASSWORD', 'An account with this email already exists'),
      );

      await controller.googleCallback(mockRequest, response, 'state-nonce', 'auth-code');

      const redirectUrl = (response.redirect as jest.Mock).mock.calls[0][0];
      expect(redirectUrl).toContain('error=OAUTH_EMAIL_ALREADY_USED_PASSWORD');
    });

    it('redirects with AUTH_RATE_LIMITED when callback is rate limited', async () => {
      rateLimiter.checkLimit.mockResolvedValue(false);

      await controller.googleCallback(mockRequest, response, 'state-nonce', 'auth-code');

      const redirectUrl = (response.redirect as jest.Mock).mock.calls[0][0];
      expect(redirectUrl).toContain('error=AUTH_RATE_LIMITED');
      expect(redirectUrl).not.toContain('message=');
      expect(response.clearCookie).toHaveBeenCalledWith(
        OAUTH_STATE_COOKIE,
        expect.objectContaining({ path: '/', sameSite: 'lax' }),
      );
    });

    it('preserves the active cookie when a mismatched callback is rate limited', async () => {
      rateLimiter.checkLimit.mockResolvedValue(false);

      await controller.googleCallback(mockRequest, response, 'different-state', 'auth-code');

      expect(response.clearCookie).not.toHaveBeenCalled();
    });
  });
});
