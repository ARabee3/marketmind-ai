import { ConfigService } from "@nestjs/config";
import { MediaFetchTokenService } from "../media-fetch-token.service";

function makeService(secret = "media-fetch-secret", ttlMs = 900000) {
  const config = {
    get: jest.fn((key: string, fallback?: string) => {
      const map: Record<string, string> = {
        "publishing.mediaFetchSecret": secret,
        "publishing.mediaFetchBaseUrl": "https://fetch.example.com",
        "publishing.mediaFetchTtlMs": String(ttlMs),
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

  it("verifies a fresh token and rejects tampered/expired ones", () => {
    const service = makeService();
    const url = new URL(service.buildUrl({ attemptId: "a1", assetId: "asset-9" }));
    const token = url.searchParams.get("token")!;
    const exp = Number(url.searchParams.get("exp"));

    expect(
      service.verify({ token, attemptId: "a1", assetId: "asset-9", expMs: exp }),
    ).toBe(true);
    // Rebind to another attempt → invalid.
    expect(
      service.verify({ token, attemptId: "a2", assetId: "asset-9", expMs: exp }),
    ).toBe(false);
    // Rebind to another asset → invalid.
    expect(
      service.verify({ token, attemptId: "a1", assetId: "asset-8", expMs: exp }),
    ).toBe(false);
    // Expired window → invalid.
    expect(
      service.verify({ token, attemptId: "a1", assetId: "asset-9", expMs: exp - 1 }),
    ).toBe(false);
  });

  it("fails closed when the fetch secret is not configured", () => {
    const service = makeService("");
    expect(service.isConfigured()).toBe(false);
    expect(() =>
      service.buildUrl({ attemptId: "a1", assetId: "asset-9" }),
    ).toThrow(/PUBLISHING_MEDIA_FETCH_SECRET/);
    expect(
      service.verify({ token: "x", attemptId: "a1", assetId: "asset-9", expMs: Date.now() + 1000 }),
    ).toBe(false);
  });
});
