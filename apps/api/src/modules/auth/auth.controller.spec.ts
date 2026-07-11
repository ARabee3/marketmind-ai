import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';

import { AuthController, REFRESH_TOKEN_COOKIE } from './auth.controller';
import { AuthService, LoginResponse, RefreshResponse, SafeUser } from './auth.service';
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
    checkLimit: jest.fn(),
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

  describe('googleAuth', () => {
    const mockRequest = { ip: '127.0.0.1' } as Request;

    it('redirects to the Google authorization URL when rate limit allows', async () => {
      rateLimiter.checkLimit.mockResolvedValue(true);
      oauthState.createState.mockResolvedValue('state-nonce');
      googleOAuth.getAuthorizationUrl.mockReturnValue(
        'https://accounts.google.com/o/oauth2/v2/auth?state=state-nonce',
      );

      await controller.googleAuth(mockRequest, response);

      expect(rateLimiter.checkLimit).toHaveBeenCalledWith(
        'oauth-initiate',
        '127.0.0.1',
      );
      expect(oauthState.createState).toHaveBeenCalledWith('google');
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
    const mockRequest = { ip: '127.0.0.1' } as Request;

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

      await controller.googleCallback(
        mockRequest,
        response,
        'state-nonce',
        'auth-code',
      );

      expect(oauthState.consumeState).toHaveBeenCalledWith('state-nonce');
      expect(googleOAuth.exchangeCode).toHaveBeenCalledWith('auth-code');
      expect(cookies[REFRESH_TOKEN_COOKIE]).toBeDefined();
      expect(cookies[REFRESH_TOKEN_COOKIE].value).toBe('raw-refresh-token');
      expect(response.redirect).toHaveBeenCalledWith(
        'http://localhost:3000/oauth/callback?status=success',
      );
    });

    it('redirects with error when state is invalid', async () => {
      const { OAuthException } = await import('./exceptions/oauth.exception');
      oauthState.consumeState.mockRejectedValue(
        new OAuthException('OAUTH_STATE_MISMATCH', 'Invalid state'),
      );

      await controller.googleCallback(
        mockRequest,
        response,
        'bad-state',
        'auth-code',
      );

      const redirectUrl = (response.redirect as jest.Mock).mock.calls[0][0];
      expect(redirectUrl).toContain('error=OAUTH_STATE_MISMATCH');
      expect(redirectUrl).toContain('message=Invalid+state');
    });

    it('redirects with error when Google returns an error query param', async () => {
      await controller.googleCallback(
        mockRequest,
        response,
        'state-nonce',
        undefined,
        'access_denied',
      );

      const redirectUrl = (response.redirect as jest.Mock).mock.calls[0][0];
      expect(redirectUrl).toContain('error=OAUTH_PROVIDER_ERROR');
      expect(redirectUrl).toContain('access_denied');
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
        new OAuthException(
          'OAUTH_EMAIL_ALREADY_USED_PASSWORD',
          'An account with this email already exists',
        ),
      );

      await controller.googleCallback(
        mockRequest,
        response,
        'state-nonce',
        'auth-code',
      );

      const redirectUrl = (response.redirect as jest.Mock).mock.calls[0][0];
      expect(redirectUrl).toContain('error=OAUTH_EMAIL_ALREADY_USED_PASSWORD');
    });

    it('redirects with AUTH_RATE_LIMITED when callback is rate limited', async () => {
      rateLimiter.checkLimit.mockResolvedValue(false);

      await controller.googleCallback(
        mockRequest,
        response,
        'state-nonce',
        'auth-code',
      );

      const redirectUrl = (response.redirect as jest.Mock).mock.calls[0][0];
      expect(redirectUrl).toContain('error=AUTH_RATE_LIMITED');
    });
  });
});
