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

  // DATABASE_URL — warn if missing, required once Auth is implemented
  if (!config.DATABASE_URL) {
    console.warn(
      "⚠️  DATABASE_URL is not set. Database features will not work.",
    );
  }

  if (errors.length > 0) {
    throw new Error(
      `Environment validation failed:\n${errors.map((e) => `  - ${e}`).join("\n")}`,
    );
  }

  return config;
}
