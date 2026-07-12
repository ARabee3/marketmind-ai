/**
 * Environment variable validation.
 *
 * Validates required env vars at application startup.
 * Throws descriptive errors if required variables are missing.
 *
 * For Sprint 1, DATABASE_URL is optional to allow the health endpoint
 * to work without a running PostgreSQL instance. Once Auth/RBAC modules
 * are implemented, DATABASE_URL should become required.
 */
export function envSchema(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const errors: string[] = [];

  // PORT is optional (defaults to 3001)
  if (config.PORT) {
    const port = parseInt(config.PORT as string, 10);
    if (isNaN(port) || port < 1 || port > 65535) {
      errors.push("PORT must be a valid port number (1-65535)");
    }
  }

  // DATABASE_URL — required for Auth module
  if (!config.DATABASE_URL) {
    errors.push("DATABASE_URL is required");
  }

  // JWT secrets — required for token issuance/verification
  if (!config.JWT_ACCESS_SECRET) {
    errors.push("JWT_ACCESS_SECRET is required");
  }
  if (!config.JWT_REFRESH_SECRET) {
    errors.push("JWT_REFRESH_SECRET is required");
  }

  // WEB_ORIGIN — required for credentialed CORS
  if (!config.WEB_ORIGIN) {
    errors.push("WEB_ORIGIN is required (e.g. http://localhost:3000)");
  }

  // REDIS_URL — required for BullMQ queue and rate limiter
  if (!config.REDIS_URL) {
    errors.push("REDIS_URL is required (e.g. redis://localhost:6379)");
  }

  // Google OAuth — required for federated sign-in (Issue #48)
  if (!config.GOOGLE_CLIENT_ID) {
    errors.push("GOOGLE_CLIENT_ID is required");
  }
  if (!config.GOOGLE_CLIENT_SECRET) {
    errors.push("GOOGLE_CLIENT_SECRET is required");
  }
  if (!config.GOOGLE_CALLBACK_URL) {
    errors.push(
      "GOOGLE_CALLBACK_URL is required (e.g. http://localhost:3001/api/v1/auth/google/callback)",
    );
  }

  // Mail delivery uses an explicit provider in deployed environments.
  const nodeEnv = (config.NODE_ENV as string | undefined) ?? "development";
  const mailProvider = config.MAIL_PROVIDER as string | undefined;

  if (mailProvider && !["mock", "brevo"].includes(mailProvider)) {
    errors.push("MAIL_PROVIDER must be one of: mock, brevo");
  }

  if (!["development", "test"].includes(nodeEnv) && !mailProvider) {
    errors.push("MAIL_PROVIDER is required outside development and test");
  }

  if (mailProvider === "brevo") {
    if (!config.BREVO_API_KEY) {
      errors.push("BREVO_API_KEY is required when MAIL_PROVIDER=brevo");
    }
    if (!config.MAIL_FROM) {
      errors.push("MAIL_FROM is required when MAIL_PROVIDER=brevo");
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `Environment validation failed:\n${errors.map((e) => `  - ${e}`).join("\n")}`,
    );
  }

  return config;
}
