import { ConfigService } from "@nestjs/config";
import { MediaFetchTokenService } from "../media-fetch-token.service";

function makeService(
  secret = "media-fetch-secret",
  ttlMs = 900000,
  overrides: { baseUrl?: string; nodeEnv?: string } = {},
) {
  const config = {
    get: jest.fn((key: string, fallback?: string) => {
      const map: Record<string, string> = {
        "publishing.mediaFetchSecret": secret,
        "publishing.mediaFetchBaseUrl":
          overrides.baseUrl ?? "https://fetch.example.com",
        "publishing.mediaFetchTtlMs": String(ttlMs),
        "app.nodeEnv": overrides.nodeEnv ?? "development",
      };
      return map[key] ?? fallback;
    }),
  } as unknown as ConfigService;
  return new MediaFetchTokenService(config);
}

describe("MediaFetchTokenService (issue #175)", () => {
  it("builds a short-lived URL bound to the exact attempt + asset", () => {
    const service = makeService();
    const url = service.buildUrl({ attemptId: "a1", assetId: "asset-9" });

    expect(url).toContain(
      "https://fetch.example.com/internal/v1/publishing/media-fetch/asset-9",
    );
    expect(url).toContain("attempt=a1");
    expect(url).toContain("token=");
    expect(url).toContain("exp=");
    expect(url).not.toContain("secret");
  });

  it("normalizes a trailing slash without changing the signed route", () => {
    const service = makeService("media-fetch-secret", 900000, {
      baseUrl: "https://fetch.example.com/",
    });

    expect(service.buildUrl({ attemptId: "a1", assetId: "asset-9" })).toMatch(
      /^https:\/\/fetch\.example\.com\/internal\//,
    );
  });

  it("verifies a fresh token and rejects tampered/expired ones", () => {
    const service = makeService();
    const url = new URL(
      service.buildUrl({ attemptId: "a1", assetId: "asset-9" }),
    );
    const token = url.searchParams.get("token")!;
    const exp = Number(url.searchParams.get("exp"));

    expect(
      service.verify({
        token,
        attemptId: "a1",
        assetId: "asset-9",
        expMs: exp,
      }),
    ).toBe(true);
    // Rebind to another attempt → invalid.
    expect(
      service.verify({
        token,
        attemptId: "a2",
        assetId: "asset-9",
        expMs: exp,
      }),
    ).toBe(false);
    // Rebind to another asset → invalid.
    expect(
      service.verify({
        token,
        attemptId: "a1",
        assetId: "asset-8",
        expMs: exp,
      }),
    ).toBe(false);
    // Expired window → invalid.
    expect(
      service.verify({
        token,
        attemptId: "a1",
        assetId: "asset-9",
        expMs: exp - 1,
      }),
    ).toBe(false);
  });

  it("fails closed when the fetch secret is not configured", () => {
    const service = makeService("");
    expect(service.isConfigured()).toBe(false);
    expect(() =>
      service.buildUrl({ attemptId: "a1", assetId: "asset-9" }),
    ).toThrow(/PUBLISHING_MEDIA_FETCH_SECRET/);
    expect(
      service.verify({
        token: "x",
        attemptId: "a1",
        assetId: "asset-9",
        expMs: Date.now() + 1000,
      }),
    ).toBe(false);
  });

  it("rejects a non-HTTPS provider URL outside development and test", () => {
    const service = makeService("media-fetch-secret", 900000, {
      baseUrl: "http://api.example.com",
      nodeEnv: "production",
    });

    expect(service.isConfigured()).toBe(false);
    expect(service.configurationError()).toContain("must use HTTPS");
    expect(() =>
      service.buildUrl({ attemptId: "a1", assetId: "asset-9" }),
    ).toThrow(/must use HTTPS/);
  });

  it("rejects a URL with a path or embedded credentials", () => {
    expect(
      makeService("media-fetch-secret", 900000, {
        baseUrl: "https://user:pass@fetch.example.com/media",
      }).configurationError(),
    ).toContain("only an origin");
  });

  // ── providerFetchOriginError (issue #240) ───────────────────────────────
  // The stricter pre-dispatch check for REAL image publishing: Meta cannot
  // fetch loopback/private HTTP origins, so they must be blocked before
  // dispatch with a specific owner-actionable error.

  describe("providerFetchOriginError", () => {
    it("accepts a public HTTPS origin", () => {
      const service = makeService("media-fetch-secret", 900000, {
        baseUrl: "https://fetch.example.com",
        nodeEnv: "development",
      });

      expect(service.providerFetchOriginError()).toBeNull();
    });

    it("rejects loopback HTTP even in development", () => {
      const service = makeService("media-fetch-secret", 900000, {
        baseUrl: "http://localhost:3001",
        nodeEnv: "development",
      });

      const error = service.providerFetchOriginError();
      expect(error).not.toBeNull();
      expect(error).toMatch(/HTTPS/);
    });

    it("rejects a private HTTPS origin even in development", () => {
      const service = makeService("media-fetch-secret", 900000, {
        baseUrl: "https://192.168.1.10",
        nodeEnv: "development",
      });

      const error = service.providerFetchOriginError();
      expect(error).not.toBeNull();
      expect(error).toMatch(/publicly reachable/);
    });

    it("rejects a 127.x loopback HTTPS origin", () => {
      const service = makeService("media-fetch-secret", 900000, {
        baseUrl: "https://127.0.0.1",
        nodeEnv: "development",
      });

      expect(service.providerFetchOriginError()).not.toBeNull();
    });

    it("rejects a 10.x private HTTPS origin", () => {
      const service = makeService("media-fetch-secret", 900000, {
        baseUrl: "https://10.0.0.1",
        nodeEnv: "development",
      });

      expect(service.providerFetchOriginError()).not.toBeNull();
    });

    it("rejects a 172.16-31 private HTTPS origin", () => {
      const service = makeService("media-fetch-secret", 900000, {
        baseUrl: "https://172.16.0.1",
        nodeEnv: "development",
      });

      expect(service.providerFetchOriginError()).not.toBeNull();
    });

    it("does not reject a public-looking 172.32 origin", () => {
      const service = makeService("media-fetch-secret", 900000, {
        baseUrl: "https://172.32.0.1",
        nodeEnv: "development",
      });

      expect(service.providerFetchOriginError()).toBeNull();
    });

    it("rejects an IPv6 loopback HTTPS origin", () => {
      const service = makeService("media-fetch-secret", 900000, {
        baseUrl: "https://[::1]",
        nodeEnv: "development",
      });

      expect(service.providerFetchOriginError()).not.toBeNull();
    });

    it("rejects an IPv6 unique-local HTTPS origin", () => {
      const service = makeService("media-fetch-secret", 900000, {
        baseUrl: "https://[fd12:3456::1]",
        nodeEnv: "development",
      });

      expect(service.providerFetchOriginError()).not.toBeNull();
    });

    it("accepts an HTTPS tunnel hostname (ngrok-style) in development", () => {
      const service = makeService("media-fetch-secret", 900000, {
        baseUrl: "https://example-tunnel.ngrok-free.app",
        nodeEnv: "development",
      });

      expect(service.providerFetchOriginError()).toBeNull();
    });

    it("surfaces the base configuration error first when the secret is missing", () => {
      const service = makeService("", 900000, {
        baseUrl: "https://fetch.example.com",
      });

      expect(service.providerFetchOriginError()).toMatch(
        /PUBLISHING_MEDIA_FETCH_SECRET/,
      );
    });

    it("still allows buildUrl when the origin is public HTTPS", () => {
      const service = makeService("media-fetch-secret", 900000, {
        baseUrl: "https://fetch.example.com",
      });

      expect(() =>
        service.buildUrl({ attemptId: "a1", assetId: "asset-9" }),
      ).not.toThrow();
    });
  });
});
