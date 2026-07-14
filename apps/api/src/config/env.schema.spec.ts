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
