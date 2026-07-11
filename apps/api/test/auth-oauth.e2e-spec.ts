import { Test, TestingModule } from "@nestjs/testing";
import { ConfigModule } from "@nestjs/config";
import { INestApplication } from "@nestjs/common";
import { Role } from "@prisma/client";
import * as bcrypt from "bcrypt";
import * as cookieParser from "cookie-parser";
import * as request from "supertest";

import { configuration } from "../src/config/configuration";
import { envSchema } from "../src/config/env.schema";
import { AuthModule } from "../src/modules/auth/auth.module";
import { GoogleOAuthClient, GoogleProfile } from "../src/modules/auth/google-oauth.client";
import { OAuthStateService, OAuthStatePayload } from "../src/modules/auth/oauth-state.service";
import { AuthRateLimiterService } from "../src/modules/auth/auth-rate-limiter.service";
import { PrismaService } from "../src/common/persistence/prisma.service";
import { RedisService } from "../src/modules/redis/redis.service";

// JWT secrets must be set before the testing module is compiled because
// JwtStrategy reads them via ConfigService at construction time.
process.env.JWT_ACCESS_SECRET = "test-access-secret";
process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
process.env.JWT_ACCESS_EXPIRES_IN = "15m";
process.env.JWT_REFRESH_EXPIRES_IN = "7d";
process.env.WEB_ORIGIN = "http://localhost:3000";
process.env.COOKIE_SECURE = "false";
process.env.COOKIE_SAME_SITE = "lax";

// Google OAuth env vars are required by env.schema.ts even though we mock
// the Google client for E2E tests.
process.env.GOOGLE_CLIENT_ID = "test-google-client-id";
process.env.GOOGLE_CLIENT_SECRET = "test-google-client-secret";
process.env.GOOGLE_CALLBACK_URL =
  "http://localhost:3001/api/v1/auth/google/callback";

// Infrastructure required by AuthModule.
process.env.DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://marketmind:marketmind_dev@localhost:5432/marketmind_dev?schema=public";
process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

const GOOGLE_SUBJECT = "google-sub-e2e-123";
const GOOGLE_EMAIL = "oauth-e2e@marketmind.ai";
const PASSWORD_EMAIL = "oauth-password-e2e@marketmind.ai";

const mockGoogleProfile: GoogleProfile = {
  providerSubject: GOOGLE_SUBJECT,
  email: GOOGLE_EMAIL,
  emailVerified: true,
  displayName: "E2E OAuth Owner",
  avatarUrl: "https://example.com/avatar.png",
  rawProfile: { sub: GOOGLE_SUBJECT, email: GOOGLE_EMAIL },
};

/**
 * In-memory OAuth state service for E2E tests so they do not require Redis.
 */
class InMemoryOAuthStateService {
  private states = new Map<string, OAuthStatePayload>();

  async createState(provider: string): Promise<string> {
    const state = `state-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    this.states.set(state, { provider });
    return state;
  }

  async consumeState(state: string | undefined): Promise<OAuthStatePayload> {
    if (!state || !this.states.has(state)) {
      const { OAuthException } = await import(
        "../src/modules/auth/exceptions/oauth.exception"
      );
      throw new OAuthException("OAUTH_STATE_MISMATCH", "Invalid or missing state");
    }
    const payload = this.states.get(state)!;
    this.states.delete(state);
    return payload;
  }
}

/**
 * Permissive rate limiter for E2E tests so they do not require Redis.
 */
class PermissiveRateLimiter {
  async checkLimit(): Promise<boolean> {
    return true;
  }
}

describe("OAuth (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let googleOAuthMock: {
    getAuthorizationUrl: jest.Mock;
    exchangeCode: jest.Mock;
  };

  beforeAll(async () => {
    googleOAuthMock = {
      getAuthorizationUrl: jest.fn().mockReturnValue("https://accounts.google.com/o/oauth2/v2/auth"),
      exchangeCode: jest.fn(),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [configuration],
          validate: envSchema,
        }),
        AuthModule,
      ],
    })
      .overrideProvider(GoogleOAuthClient)
      .useValue(googleOAuthMock)
      .overrideProvider(OAuthStateService)
      .useValue(new InMemoryOAuthStateService())
      .overrideProvider(AuthRateLimiterService)
      .useValue(new PermissiveRateLimiter())
      .overrideProvider(RedisService)
      .useValue({ getClient: () => ({ ping: jest.fn() }) })
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix("api/v1");
    app.use(cookieParser());
    await app.init();

    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    googleOAuthMock.getAuthorizationUrl.mockReturnValue(
      "https://accounts.google.com/o/oauth2/v2/auth",
    );

    // Clean up any leftover test data.
    await prisma.federatedIdentity.deleteMany({
      where: { providerSubject: GOOGLE_SUBJECT },
    });
    await prisma.user.deleteMany({ where: { email: GOOGLE_EMAIL } });
    await prisma.user.deleteMany({ where: { email: PASSWORD_EMAIL } });
  });

  async function startGoogleOAuth() {
    const agent = request.agent(app.getHttpServer());
    const initiationResponse = await agent
      .get("/api/v1/auth/google")
      .expect(302)
      .expect("Location", /accounts\.google\.com/);
    const calls = googleOAuthMock.getAuthorizationUrl.mock.calls;
    const state = calls[calls.length - 1][0] as string;
    return { agent, initiationResponse, state };
  }

  // ========================================================================
  // GET /api/v1/auth/google
  // ========================================================================

  describe("GET /api/v1/auth/google", () => {
    it("redirects to Google with a stored state", async () => {
      const { initiationResponse, state } = await startGoogleOAuth();

      expect(googleOAuthMock.getAuthorizationUrl).toHaveBeenCalledTimes(1);
      expect(state).toBeTruthy();
      const cookies = initiationResponse.headers["set-cookie"] as unknown as string[];
      const stateCookie = cookies.find((cookie) => cookie.startsWith("oauthState="));
      expect(stateCookie).toContain("HttpOnly");
      expect(stateCookie).toContain("SameSite=Lax");
    });
  });

  // ========================================================================
  // GET /api/v1/auth/google/callback
  // ========================================================================

  describe("GET /api/v1/auth/google/callback", () => {
    it("creates a new verified owner and redirects to success", async () => {
      googleOAuthMock.exchangeCode.mockResolvedValue(mockGoogleProfile);
      const { agent, state } = await startGoogleOAuth();

      await agent
        .get(`/api/v1/auth/google/callback?state=${state}&code=valid-code`)
        .expect(302)
        .expect("Location", /\/oauth\/callback\?status=success/)
        .expect((res) => {
          expect(res.headers["set-cookie"]).toBeDefined();
          const cookies = res.headers["set-cookie"] as unknown as string[];
          const cookie = cookies.find((c) => c.startsWith("refreshToken="));
          expect(cookie).toBeDefined();
          expect(cookie).toContain("HttpOnly");
        });

      const user = await prisma.user.findUnique({ where: { email: GOOGLE_EMAIL } });
      expect(user).not.toBeNull();
      expect(user?.isEmailVerified).toBe(true);
      expect(user?.roles).toEqual([Role.OWNER]);

      const identity = await prisma.federatedIdentity.findUnique({
        where: {
          provider_providerSubject: {
            provider: "google",
            providerSubject: GOOGLE_SUBJECT,
          },
        },
      });
      expect(identity).not.toBeNull();
      expect(identity?.userId).toBe(user?.id);
    });

    it("signs in a returning identity without creating a duplicate user", async () => {
      googleOAuthMock.exchangeCode.mockResolvedValue(mockGoogleProfile);
      const { agent, state } = await startGoogleOAuth();

      // First callback creates the account.
      await agent
        .get(`/api/v1/auth/google/callback?state=${state}&code=valid-code`)
        .expect(302);

      const firstUser = await prisma.user.findUnique({
        where: { email: GOOGLE_EMAIL },
      });
      expect(firstUser).not.toBeNull();

      // Second callback with a fresh state should sign in the same user.
      const secondFlow = await startGoogleOAuth();
      await secondFlow.agent
        .get(`/api/v1/auth/google/callback?state=${secondFlow.state}&code=valid-code`)
        .expect(302)
        .expect("Location", /\/oauth\/callback\?status=success/);

      const users = await prisma.user.findMany({ where: { email: GOOGLE_EMAIL } });
      expect(users).toHaveLength(1);
    });

    it("rejects same-email password accounts without linking", async () => {
      await prisma.user.create({
        data: {
          email: PASSWORD_EMAIL,
          password: await bcrypt.hash("Password123!", 12),
          fullName: "Password Owner",
        },
      });

      googleOAuthMock.exchangeCode.mockResolvedValue({
        ...mockGoogleProfile,
        email: PASSWORD_EMAIL,
      });
      const { agent, state } = await startGoogleOAuth();

      await agent
        .get(`/api/v1/auth/google/callback?state=${state}&code=valid-code`)
        .expect(302)
        .expect((res) => {
          expect(res.headers.location).toContain(
            "error=OAUTH_EMAIL_ALREADY_USED_PASSWORD",
          );
        });
    });

    it("redirects with OAUTH_STATE_MISMATCH for an invalid state", async () => {
      googleOAuthMock.exchangeCode.mockResolvedValue(mockGoogleProfile);
      const { agent, state } = await startGoogleOAuth();

      await agent
        .get("/api/v1/auth/google/callback?state=invalid-state&code=valid-code")
        .expect(302)
        .expect((res) => {
          expect(res.headers.location).toContain("error=OAUTH_STATE_MISMATCH");
        });

      // A mismatched callback must not clear the active browser-bound state.
      await agent
        .get(`/api/v1/auth/google/callback?state=${state}&code=valid-code`)
        .expect(302)
        .expect("Location", /\/oauth\/callback\?status=success/);
    });

    it("redirects with OAUTH_PROVIDER_ERROR when Google returns an error", async () => {
      const { agent, state } = await startGoogleOAuth();

      await agent
        .get(`/api/v1/auth/google/callback?state=${state}&error=access_denied`)
        .expect(302)
        .expect((res) => {
          expect(res.headers.location).toContain("error=OAUTH_PROVIDER_ERROR");
          expect(res.headers.location).not.toContain("access_denied");
          expect(res.headers.location).not.toContain("message=");
        });
    });

  });
});
