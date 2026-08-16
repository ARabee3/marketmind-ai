import { envSchema } from "./env.schema";

const validConfig = (): Record<string, unknown> => ({
  NODE_ENV: "development",
  DATABASE_URL: "postgresql://localhost/marketmind",
  JWT_ACCESS_SECRET: "access-secret",
  JWT_REFRESH_SECRET: "refresh-secret",
  WEB_ORIGIN: "http://localhost:3000",
  REDIS_URL: "redis://localhost:6379",
  GOOGLE_CLIENT_ID: "google-client-id",
  GOOGLE_CLIENT_SECRET: "google-client-secret",
  GOOGLE_CALLBACK_URL: "http://localhost:3001/api/v1/auth/google/callback",
  MAIL_PROVIDER: "mock",
  FB_APP_ID: "facebook-app-id",
  FB_APP_SECRET: "facebook-app-secret",
  FB_REDIRECT_URI: "http://localhost:3001/api/v1/auth/facebook/callback",
  TOKEN_ENCRYPTION_KEY:
    "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff",
});

describe("envSchema mail configuration", () => {
  it("accepts the mock provider without external credentials", () => {
    const config = validConfig();

    expect(envSchema(config)).toBe(config);
  });

  it("accepts a completely configured SMTP provider", () => {
    const config = {
      ...validConfig(),
      MAIL_PROVIDER: "smtp",
      SMTP_HOST: "smtp.gmail.com",
      SMTP_PORT: "587",
      SMTP_USER: "team@example.com",
      SMTP_PASS: "app-password",
      MAIL_FROM: "no-reply@example.com",
    };

    expect(envSchema(config)).toBe(config);
  });

  it("rejects an unknown provider", () => {
    expect(() =>
      envSchema({ ...validConfig(), MAIL_PROVIDER: "unknown" }),
    ).toThrow("MAIL_PROVIDER must be one of: mock, smtp");
  });

  it("rejects incomplete SMTP configuration", () => {
    expect(() =>
      envSchema({ ...validConfig(), MAIL_PROVIDER: "smtp" }),
    ).toThrow("SMTP_HOST is required when MAIL_PROVIDER=smtp");
  });

  it("requires explicit provider selection in production", () => {
    const config = validConfig();
    config.NODE_ENV = "production";
    delete config.MAIL_PROVIDER;

    expect(() => envSchema(config)).toThrow(
      "MAIL_PROVIDER is required outside development and test",
    );
  });
});

describe("envSchema orchestration feature flag", () => {
  it("keeps orchestration disabled when the flag is omitted", () => {
    expect(envSchema(validConfig())).toBeDefined();
  });

  it.each(["true", "false"])("accepts an explicit %s value", (value) => {
    const config = { ...validConfig(), AI_ORCHESTRATION_ENABLED: value };
    expect(envSchema(config)).toBe(config);
  });

  it("rejects an ambiguous orchestration flag", () => {
    expect(() =>
      envSchema({ ...validConfig(), AI_ORCHESTRATION_ENABLED: "yes" }),
    ).toThrow("AI_ORCHESTRATION_ENABLED must be true or false");
  });
});

describe("envSchema content asset storage configuration", () => {
  it("keeps filesystem storage as the default", () => {
    expect(envSchema(validConfig())).toBeDefined();
  });

  it("accepts a complete R2 configuration", () => {
    const config = {
      ...validConfig(),
      ASSET_STORAGE_PROVIDER: "r2",
      CLOUDFLARE_R2_ENDPOINT: "https://account.r2.cloudflarestorage.com",
      CLOUDFLARE_R2_ACCESS_KEY_ID: "access-key",
      CLOUDFLARE_R2_SECRET_ACCESS_KEY: "secret-key",
      CLOUDFLARE_R2_BUCKET: "marketmind-ai",
      CLOUDFLARE_R2_USE_PATH_STYLE_ENDPOINT: "true",
    };

    expect(envSchema(config)).toBe(config);
  });

  it("rejects an unknown content asset storage provider", () => {
    expect(() =>
      envSchema({ ...validConfig(), ASSET_STORAGE_PROVIDER: "s3" }),
    ).toThrow("ASSET_STORAGE_PROVIDER must be one of: filesystem, r2");
  });

  it("rejects incomplete R2 configuration", () => {
    expect(() =>
      envSchema({ ...validConfig(), ASSET_STORAGE_PROVIDER: "r2" }),
    ).toThrow(
      "CLOUDFLARE_R2_ENDPOINT is required when ASSET_STORAGE_PROVIDER=r2",
    );
  });

  it("rejects an ambiguous R2 path-style flag", () => {
    expect(() =>
      envSchema({
        ...validConfig(),
        CLOUDFLARE_R2_USE_PATH_STYLE_ENDPOINT: "yes",
      }),
    ).toThrow("CLOUDFLARE_R2_USE_PATH_STYLE_ENDPOINT must be true or false");
  });
});

describe("envSchema Facebook enrichment configuration", () => {
  it("accepts the documented bounded actor configuration", () => {
    const config = {
      ...validConfig(),
      DISCOVERY_FACEBOOK_ENRICHMENT_ENABLED: "true",
      DISCOVERY_FACEBOOK_POSTS_ENABLED: "true",
      DISCOVERY_FACEBOOK_MAX_PAGES: "1",
      DISCOVERY_FACEBOOK_MAX_POSTS: "5",
      DISCOVERY_FACEBOOK_TIMEOUT_MS: "60000",
      DISCOVERY_FACEBOOK_SESSION_MAX_CHARGE_USD: "0.05",
      DISCOVERY_FACEBOOK_PAGES_MAX_CHARGE_USD: "0.02",
      DISCOVERY_FACEBOOK_POSTS_MAX_CHARGE_USD: "0.03",
    };

    expect(envSchema(config)).toBe(config);
  });

  it("rejects actor allocations above the Facebook session cap", () => {
    expect(() =>
      envSchema({
        ...validConfig(),
        DISCOVERY_FACEBOOK_SESSION_MAX_CHARGE_USD: "0.05",
        DISCOVERY_FACEBOOK_PAGES_MAX_CHARGE_USD: "0.03",
        DISCOVERY_FACEBOOK_POSTS_MAX_CHARGE_USD: "0.03",
      }),
    ).toThrow(
      "Facebook actor charge allocations must not exceed the session cap",
    );
  });

  it.each([
    ["DISCOVERY_FACEBOOK_MAX_PAGES", "2", "between 1 and 1"],
    ["DISCOVERY_FACEBOOK_MAX_POSTS", "6", "between 1 and 5"],
    ["DISCOVERY_FACEBOOK_TIMEOUT_MS", "60001", "between 1 and 60000"],
  ])("rejects an unsafe %s limit", (key, value, message) => {
    expect(() => envSchema({ ...validConfig(), [key]: value })).toThrow(
      message,
    );
  });
});

describe("envSchema Facebook connection validation", () => {
  it("accepts a valid 32-byte hex-encoded token encryption key", () => {
    expect(envSchema(validConfig())).toBeDefined();
  });

  it("rejects missing Facebook app credentials", () => {
    const config = validConfig();
    delete config.FB_APP_ID;
    delete config.FB_APP_SECRET;

    expect(() => envSchema(config)).toThrow(
      "FB_APP_ID is required for the Facebook Page connection",
    );
  });

  it("rejects a token encryption key that does not decode to 32 bytes", () => {
    expect(() =>
      envSchema({ ...validConfig(), TOKEN_ENCRYPTION_KEY: "not-a-valid-key" }),
    ).toThrow("TOKEN_ENCRYPTION_KEY must be exactly 64 hexadecimal characters");
  });

  it("rejects trailing non-hex data after an otherwise valid key", () => {
    const validKey = validConfig().TOKEN_ENCRYPTION_KEY as string;

    expect(() =>
      envSchema({
        ...validConfig(),
        TOKEN_ENCRYPTION_KEY: `${validKey}zz`,
      }),
    ).toThrow("TOKEN_ENCRYPTION_KEY must be exactly 64 hexadecimal characters");
  });

  it("rejects a missing token encryption key", () => {
    const config = validConfig();
    delete config.TOKEN_ENCRYPTION_KEY;

    expect(() => envSchema(config)).toThrow("TOKEN_ENCRYPTION_KEY is required");
  });
});

describe("envSchema billing provider configuration", () => {
  it("requires the Paymob merchant boundary before enabling Paymob", () => {
    expect(() =>
      envSchema({ ...validConfig(), BILLING_PROVIDER: "paymob" }),
    ).toThrow("PAYMOB_SECRET_KEY is required when BILLING_PROVIDER=paymob");
  });

  it("accepts a configured Paymob sandbox boundary", () => {
    const config = {
      ...validConfig(),
      BILLING_PROVIDER: "paymob",
      PAYMOB_SECRET_KEY: "secret",
      PAYMOB_PUBLIC_KEY: "pk_test_123",
      PAYMOB_INTEGRATION_IDS: "987",
      PAYMOB_HMAC_SECRET: "hmac",
    };

    expect(envSchema(config)).toBe(config);
  });

  it("does not accept the legacy API Key in place of the Secret Key", () => {
    expect(() =>
      envSchema({
        ...validConfig(),
        BILLING_PROVIDER: "paymob",
        PAYMOB_API_KEY: "legacy",
        PAYMOB_PUBLIC_KEY: "pk_test_123",
        PAYMOB_INTEGRATION_IDS: "987",
        PAYMOB_HMAC_SECRET: "hmac",
      }),
    ).toThrow("PAYMOB_SECRET_KEY is required when BILLING_PROVIDER=paymob");
  });
});
