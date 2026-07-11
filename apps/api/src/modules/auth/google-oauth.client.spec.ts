import { ConfigService } from "@nestjs/config";
import { GoogleOAuthClient, GoogleProfile } from "./google-oauth.client";
import { OAuthException } from "./exceptions/oauth.exception";

const mockGenerateAuthUrl = jest.fn();
const mockGetToken = jest.fn();
const mockVerifyIdToken = jest.fn();

jest.mock("google-auth-library", () => ({
  OAuth2Client: jest.fn().mockImplementation(() => ({
    generateAuthUrl: mockGenerateAuthUrl,
    getToken: mockGetToken,
    verifyIdToken: mockVerifyIdToken,
  })),
}));

const createMockConfigService = (overrides: Record<string, string> = {}) =>
  ({
    get: jest.fn((key: string) => {
      const map: Record<string, string> = {
        "google.clientId": "google-client-id",
        "google.clientSecret": "google-client-secret",
        "google.callbackUrl": "http://localhost:3001/api/v1/auth/google/callback",
        ...overrides,
      };
      return map[key];
    }),
    getOrThrow: jest.fn(),
  }) as unknown as ConfigService;

describe("GoogleOAuthClient", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("constructor", () => {
    it("throws OAUTH_CONFIGURATION_ERROR when Google config is incomplete", () => {
      const config = createMockConfigService({ "google.clientSecret": "" });

      expect(() => new GoogleOAuthClient(config)).toThrow(OAuthException);
      expect(() => new GoogleOAuthClient(config)).toThrow(
        /Google OAuth is not fully configured/,
      );
    });
  });

  describe("getAuthorizationUrl()", () => {
    it("generates an authorization URL with the provided state", () => {
      const config = createMockConfigService();
      const client = new GoogleOAuthClient(config);
      mockGenerateAuthUrl.mockReturnValue(
        "https://accounts.google.com/o/oauth2/v2/auth?state=nonce",
      );

      const url = client.getAuthorizationUrl("nonce-123");

      expect(url).toContain("state=nonce");
      expect(mockGenerateAuthUrl).toHaveBeenCalledWith({
        access_type: "online",
        scope: ["openid", "email", "profile"],
        include_granted_scopes: true,
        state: "nonce-123",
      });
    });
  });

  describe("exchangeCode()", () => {
    const basePayload = {
      sub: "google-sub-123",
      email: "owner@example.com",
      email_verified: true,
      name: "Test Owner",
      picture: "https://example.com/avatar.png",
    };

    const createClient = () => {
      const config = createMockConfigService();
      const client = new GoogleOAuthClient(config);
      return { config, client };
    };

    it("returns a normalized profile for a valid code", async () => {
      const { client } = createClient();
      mockGetToken.mockResolvedValue({ tokens: { id_token: "id-token" } });
      mockVerifyIdToken.mockResolvedValue({
        getPayload: () => basePayload,
      });

      const result = await client.exchangeCode("valid-code");

      expect(result).toEqual<GoogleProfile>({
        providerSubject: "google-sub-123",
        email: "owner@example.com",
        emailVerified: true,
        displayName: "Test Owner",
        avatarUrl: "https://example.com/avatar.png",
        rawProfile: basePayload,
      });
      expect(mockGetToken).toHaveBeenCalledWith("valid-code");
      expect(mockVerifyIdToken).toHaveBeenCalledWith({
        idToken: "id-token",
        audience: "google-client-id",
      });
    });

    it("throws OAUTH_PROVIDER_ERROR when Google returns no ID token", async () => {
      const { client } = createClient();
      mockGetToken.mockResolvedValue({ tokens: {} });

      await expect(client.exchangeCode("code")).rejects.toMatchObject({
        code: "OAUTH_PROVIDER_ERROR",
      });
    });

    it("throws OAUTH_PROVIDER_ERROR when token exchange fails", async () => {
      const { client } = createClient();
      mockGetToken.mockRejectedValue(new Error("invalid_grant"));

      await expect(client.exchangeCode("code")).rejects.toMatchObject({
        code: "OAUTH_PROVIDER_ERROR",
      });
    });

    it("throws OAUTH_PROVIDER_ERROR when ID token verification fails", async () => {
      const { client } = createClient();
      mockGetToken.mockResolvedValue({ tokens: { id_token: "id-token" } });
      mockVerifyIdToken.mockRejectedValue(new Error("invalid token"));

      await expect(client.exchangeCode("code")).rejects.toMatchObject({
        code: "OAUTH_PROVIDER_ERROR",
      });
    });

    it("throws OAUTH_PROVIDER_ERROR when payload is empty", async () => {
      const { client } = createClient();
      mockGetToken.mockResolvedValue({ tokens: { id_token: "id-token" } });
      mockVerifyIdToken.mockResolvedValue({ getPayload: () => null });

      await expect(client.exchangeCode("code")).rejects.toMatchObject({
        code: "OAUTH_PROVIDER_ERROR",
      });
    });

    it("throws OAUTH_PROVIDER_ERROR when required claims are missing", async () => {
      const { client } = createClient();
      mockGetToken.mockResolvedValue({ tokens: { id_token: "id-token" } });
      mockVerifyIdToken.mockResolvedValue({
        getPayload: () => ({ email_verified: true }),
      });

      await expect(client.exchangeCode("code")).rejects.toMatchObject({
        code: "OAUTH_PROVIDER_ERROR",
      });
    });

    it("marks emailVerified false when Google has not verified the email", async () => {
      const { client } = createClient();
      mockGetToken.mockResolvedValue({ tokens: { id_token: "id-token" } });
      mockVerifyIdToken.mockResolvedValue({
        getPayload: () => ({
          sub: "google-sub-123",
          email: "owner@example.com",
          email_verified: false,
        }),
      });

      const result = await client.exchangeCode("code");

      expect(result.emailVerified).toBe(false);
    });

    it("allows missing optional profile fields", async () => {
      const { client } = createClient();
      mockGetToken.mockResolvedValue({ tokens: { id_token: "id-token" } });
      mockVerifyIdToken.mockResolvedValue({
        getPayload: () => ({
          sub: "google-sub-123",
          email: "owner@example.com",
          email_verified: true,
        }),
      });

      const result = await client.exchangeCode("code");

      expect(result.displayName).toBeUndefined();
      expect(result.avatarUrl).toBeUndefined();
    });
  });
});
