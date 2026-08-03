/**
 * Typed application configuration.
 *
 * Values come from environment variables (validated by env.schema.ts).
 * This factory is registered with ConfigModule.forRoot({ load: [configuration] }).
 */
import { DEFAULT_AI_REQUEST_TIMEOUT_MS } from "../common/config/external-provider.config";

export const configuration = () => ({
  port: parseInt(process.env.PORT || "3001", 10),

  database: {
    url: process.env.DATABASE_URL || "",
  },

  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET || "",
    refreshSecret: process.env.JWT_REFRESH_SECRET || "",
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || "15m",
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || "7d",
  },

  cookies: {
    secure: process.env.COOKIE_SECURE === "true",
    sameSite:
      (process.env.COOKIE_SAME_SITE as "lax" | "strict" | "none") || "lax",
  },

  cors: {
    origin: process.env.WEB_ORIGIN || "http://localhost:3000",
  },

  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
    callbackUrl: process.env.GOOGLE_CALLBACK_URL || "",
  },

  redis: {
    url: process.env.REDIS_URL || "redis://localhost:6379",
  },

  discovery: {
    workerEnabled: process.env.DISCOVERY_WORKER_ENABLED !== "false",
    workerConcurrency:
      parseInt(process.env.DISCOVERY_WORKER_CONCURRENCY || "2", 10) || 2,
  },

  mail: {
    provider: process.env.MAIL_PROVIDER || "mock",
    smtp: {
      host: process.env.SMTP_HOST || "",
      port: parseInt(process.env.SMTP_PORT || "587", 10),
      user: process.env.SMTP_USER || "",
      pass: process.env.SMTP_PASS || "",
    },
    from: process.env.MAIL_FROM || "",
    appUrl: process.env.APP_URL || "http://localhost:3000",
  },

  app: {
    nodeEnv: process.env.NODE_ENV || "development",
  },

  aiService: {
    // Single source of truth for the FastAI base URL. Aliases the existing
    // AI_SERVICE_BASE_URL env var also consumed by external-provider.config.ts
    // so Discovery and Strategy never drift.
    url: process.env.AI_SERVICE_BASE_URL || "http://localhost:8000",
    requestTimeoutMs:
      parseInt(process.env.AI_REQUEST_TIMEOUT_MS || "", 10) ||
      DEFAULT_AI_REQUEST_TIMEOUT_MS,
  },

  publishing: {
    // n8n webhook URL — the endpoint this service POSTs dispatch requests to
    n8nWebhookUrl: process.env.PUBLISHING_N8N_WEBHOOK_URL || "",
    // HMAC signing secret used ONLY to sign outbound dispatch payloads and to
    // verify inbound n8n callbacks. This is the symmetric MAC key and is NEVER
    // sent as a bearer token on the wire (a shared MAC secret doubling as a
    // transport credential collapses two distinct security boundaries and
    // removes any key-rotation seam — see N8nClientService).
    n8nSigningSecret: process.env.PUBLISHING_N8N_SIGNING_SECRET || "",
    // Optional key id for the signing secret, included in signed payloads and
    // inbound callbacks so n8n / this service can rotate keys without a
    // shared big-bang redeploy. Empty disables kid (single-key mode).
    n8nSigningKeyId: process.env.PUBLISHING_N8N_SIGNING_KID || "",
    // SEPARATE bearer credential used to authenticate outbound requests TO
    // n8n (Authorization: Bearer <n8nAuthToken>). This is distinct from the
    // HMAC signing secret on purpose (issue #119 blocker: do not reuse the
    // signing secret as the bearer token). Required at dispatch time; an
    // empty value makes N8nClientService fail fast with a clear error.
    n8nAuthToken: process.env.PUBLISHING_N8N_AUTH_TOKEN || "",
    // Base URL for the callback this service advertises to n8n
    callbackBaseUrl:
      process.env.PUBLISHING_CALLBACK_BASE_URL || "http://localhost:3001",
    // Pinned workflow version sent on every dispatch (audit trail)
    workflowVersion: process.env.PUBLISHING_WORKFLOW_VERSION || "v1",
    // Max age for signed callbacks (ms) — reject anything older
    callbackWindowMs: parseInt(
      process.env.PUBLISHING_CALLBACK_WINDOW_MS || "300000",
      10,
    ),
  },
});
