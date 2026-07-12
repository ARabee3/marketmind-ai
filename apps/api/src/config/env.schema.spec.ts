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

  it("accepts a completely configured Brevo provider", () => {
    const config = {
      ...validConfig(),
      MAIL_PROVIDER: "brevo",
      BREVO_API_KEY: "brevo-api-key",
      MAIL_FROM: "team@example.com",
    };

    expect(envSchema(config)).toBe(config);
  });

  it("rejects an unknown provider", () => {
    expect(() =>
      envSchema({ ...validConfig(), MAIL_PROVIDER: "unknown" }),
    ).toThrow("MAIL_PROVIDER must be one of: mock, brevo");
  });

  it("rejects incomplete Brevo configuration", () => {
    expect(() =>
      envSchema({ ...validConfig(), MAIL_PROVIDER: "brevo" }),
    ).toThrow("BREVO_API_KEY is required when MAIL_PROVIDER=brevo");
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
