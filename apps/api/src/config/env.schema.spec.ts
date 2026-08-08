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

describe("envSchema Content v2 default feature flag", () => {
  it("allows the flag to be omitted because v2 is the application default", () => {
    expect(envSchema(validConfig())).toBeDefined();
  });

  it.each(["true", "false"])("accepts an explicit %s value", (value) => {
    const config = { ...validConfig(), CONTENT_V2_DEFAULT_ENABLED: value };
    expect(envSchema(config)).toBe(config);
  });

  it("rejects an ambiguous content v2 default flag", () => {
    expect(() =>
      envSchema({ ...validConfig(), CONTENT_V2_DEFAULT_ENABLED: "yes" }),
    ).toThrow("CONTENT_V2_DEFAULT_ENABLED must be true or false");
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

describe("envSchema billing provider configuration", () => {
  it("requires the Paymob merchant boundary before enabling Paymob", () => {
    expect(() =>
      envSchema({ ...validConfig(), BILLING_PROVIDER: "paymob" }),
    ).toThrow("PAYMOB_API_KEY is required when BILLING_PROVIDER=paymob");
  });

  it("accepts a configured Paymob sandbox boundary", () => {
    const config = {
      ...validConfig(),
      BILLING_PROVIDER: "paymob",
      PAYMOB_API_KEY: "secret",
      PAYMOB_PUBLIC_KEY: "pk_test_123",
      PAYMOB_INTEGRATION_IDS: "987",
      PAYMOB_HMAC_SECRET: "hmac",
    };

    expect(envSchema(config)).toBe(config);
  });
});
