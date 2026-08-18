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

  const assetStorageProvider =
    (config.ASSET_STORAGE_PROVIDER as string | undefined) || "filesystem";
  if (!["filesystem", "r2"].includes(assetStorageProvider)) {
    errors.push("ASSET_STORAGE_PROVIDER must be one of: filesystem, r2");
  }

  const r2PathStyle = config.CLOUDFLARE_R2_USE_PATH_STYLE_ENDPOINT;
  if (
    r2PathStyle !== undefined &&
    r2PathStyle !== "" &&
    r2PathStyle !== "true" &&
    r2PathStyle !== "false"
  ) {
    errors.push("CLOUDFLARE_R2_USE_PATH_STYLE_ENDPOINT must be true or false");
  }

  if (assetStorageProvider === "r2") {
    if (!config.CLOUDFLARE_R2_ENDPOINT) {
      errors.push(
        "CLOUDFLARE_R2_ENDPOINT is required when ASSET_STORAGE_PROVIDER=r2",
      );
    }
    if (!config.CLOUDFLARE_R2_ACCESS_KEY_ID) {
      errors.push(
        "CLOUDFLARE_R2_ACCESS_KEY_ID is required when ASSET_STORAGE_PROVIDER=r2",
      );
    }
    if (!config.CLOUDFLARE_R2_SECRET_ACCESS_KEY) {
      errors.push(
        "CLOUDFLARE_R2_SECRET_ACCESS_KEY is required when ASSET_STORAGE_PROVIDER=r2",
      );
    }
    if (!config.CLOUDFLARE_R2_BUCKET) {
      errors.push(
        "CLOUDFLARE_R2_BUCKET is required when ASSET_STORAGE_PROVIDER=r2",
      );
    }
  }

  const orchestrationEnabled = config.AI_ORCHESTRATION_ENABLED;
  if (
    orchestrationEnabled !== undefined &&
    orchestrationEnabled !== "" &&
    orchestrationEnabled !== "true" &&
    orchestrationEnabled !== "false"
  ) {
    errors.push("AI_ORCHESTRATION_ENABLED must be true or false");
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

  // Facebook Page connection — required because FacebookModule is always wired
  // into AppModule, and the popup OAuth flow never surfaces config errors.
  if (!config.FB_APP_ID) {
    errors.push("FB_APP_ID is required for the Facebook Page connection");
  }
  if (!config.FB_APP_SECRET) {
    errors.push("FB_APP_SECRET is required for the Facebook Page connection");
  }
  if (!config.FB_REDIRECT_URI) {
    errors.push(
      "FB_REDIRECT_URI is required (e.g. http://localhost:3001/api/v1/auth/facebook/callback)",
    );
  }
  const tokenEncryptionKey = config.TOKEN_ENCRYPTION_KEY as string | undefined;
  if (!tokenEncryptionKey) {
    errors.push(
      "TOKEN_ENCRYPTION_KEY is required (AES-256-GCM key, 32 bytes hex-encoded)",
    );
  } else if (!/^[0-9a-fA-F]{64}$/.test(tokenEncryptionKey)) {
    errors.push(
      "TOKEN_ENCRYPTION_KEY must be exactly 64 hexadecimal characters (AES-256-GCM key)",
    );
  }

  // Mail delivery uses an explicit provider in deployed environments.
  const nodeEnv = (config.NODE_ENV as string | undefined) ?? "development";
  const mailProvider = config.MAIL_PROVIDER as string | undefined;

  if (mailProvider && !["mock", "smtp"].includes(mailProvider)) {
    errors.push("MAIL_PROVIDER must be one of: mock, smtp");
  }

  if (!["development", "test"].includes(nodeEnv) && !mailProvider) {
    errors.push("MAIL_PROVIDER is required outside development and test");
  }

  if (mailProvider === "smtp") {
    if (!config.SMTP_HOST) {
      errors.push("SMTP_HOST is required when MAIL_PROVIDER=smtp");
    }
    if (!config.SMTP_USER) {
      errors.push("SMTP_USER is required when MAIL_PROVIDER=smtp");
    }
    if (!config.SMTP_PASS) {
      errors.push("SMTP_PASS is required when MAIL_PROVIDER=smtp");
    }
    if (!config.MAIL_FROM) {
      errors.push("MAIL_FROM is required when MAIL_PROVIDER=smtp");
    }
  }

  const billingProvider = config.BILLING_PROVIDER as string | undefined;
  if (
    billingProvider &&
    !["fake", "paymob", "geidea"].includes(billingProvider)
  ) {
    errors.push("BILLING_PROVIDER must be one of: fake, paymob, geidea");
  }

  if (billingProvider === "paymob") {
    if (!config.PAYMOB_SECRET_KEY) {
      errors.push("PAYMOB_SECRET_KEY is required when BILLING_PROVIDER=paymob");
    }
    if (!config.PAYMOB_PUBLIC_KEY) {
      errors.push("PAYMOB_PUBLIC_KEY is required when BILLING_PROVIDER=paymob");
    }
    if (!config.PAYMOB_INTEGRATION_IDS) {
      errors.push(
        "PAYMOB_INTEGRATION_IDS is required when BILLING_PROVIDER=paymob",
      );
    }
    if (!config.PAYMOB_HMAC_SECRET) {
      errors.push(
        "PAYMOB_HMAC_SECRET is required when BILLING_PROVIDER=paymob",
      );
    }
  }

  boundedNumber(config, "DISCOVERY_FACEBOOK_MAX_PAGES", 1, 1, errors);
  boundedNumber(config, "DISCOVERY_FACEBOOK_MAX_POSTS", 1, 5, errors);
  boundedNumber(config, "DISCOVERY_FACEBOOK_TIMEOUT_MS", 1, 60_000, errors);
  const sessionCap = boundedNumber(
    config,
    "DISCOVERY_FACEBOOK_SESSION_MAX_CHARGE_USD",
    Number.EPSILON,
    1,
    errors,
    0.05,
  );
  const pageCap = boundedNumber(
    config,
    "DISCOVERY_FACEBOOK_PAGES_MAX_CHARGE_USD",
    Number.EPSILON,
    1,
    errors,
    0.02,
  );
  const postCap = boundedNumber(
    config,
    "DISCOVERY_FACEBOOK_POSTS_MAX_CHARGE_USD",
    Number.EPSILON,
    1,
    errors,
    0.03,
  );
  if (pageCap + postCap > sessionCap + Number.EPSILON) {
    errors.push(
      "Facebook actor charge allocations must not exceed the session cap",
    );
  }

  if (errors.length > 0) {
    throw new Error(
      `Environment validation failed:\n${errors.map((e) => `  - ${e}`).join("\n")}`,
    );
  }

  return config;
}

function boundedNumber(
  config: Record<string, unknown>,
  key: string,
  minimum: number,
  maximum: number,
  errors: string[],
  fallback = minimum,
): number {
  const raw = config[key];
  if (raw === undefined || raw === "") {
    return fallback;
  }

  const value = Number(raw);
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    errors.push(`${key} must be between ${minimum} and ${maximum}`);
    return fallback;
  }
  return value;
}
