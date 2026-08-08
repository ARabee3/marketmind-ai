/**
 * Typed application configuration.
 *
 * Values come from environment variables (validated by env.schema.ts).
 * This factory is registered with ConfigModule.forRoot({ load: [configuration] }).
 */
import * as path from "path";
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

  orchestration: {
    // Explicit opt-in only. Deploying the Phase 1 contracts must not change
    // which path existing workers use.
    enabled: process.env.AI_ORCHESTRATION_ENABLED === "true",
  },

  content: {
    // Root directory for content asset blobs written through the
    // AssetStorage port (arch doc 831). Defaults to a repo-local directory;
    // deployments override via CONTENT_ASSET_ROOT.
    assetRoot: process.env.CONTENT_ASSET_ROOT || "./.content-assets",
    // Content v2 is the default owner-first studio path (issue #187). Set
    // CONTENT_V2_DEFAULT_ENABLED=false only when an explicit legacy v1
    // fallback is required for a deployment or migration window.
    v2DefaultEnabled: process.env.CONTENT_V2_DEFAULT_ENABLED !== "false",
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
    // SEPARATE shared bearer token authenticating INTERNAL publishing routes
    // (authoritative content-service candidate handoff, and the internal asset
    // route). Distinct from the owner access JWT and the n8n HMAC signing
    // secret; never put on the browser. Empty → internal routes fail closed.
    internalServiceToken: process.env.PUBLISHING_INTERNAL_SERVICE_TOKEN || "",
    // Local filesystem directory holding the committed demo asset manifest +
    // media bytes served by the internal asset route (#121). Defaults to the
    // test-assets dir relative to the process cwd so `nest start` and ts-node
    // resolve it without extra config. Object storage is a future concern.
    assetStoreDir:
      process.env.PUBLISHING_ASSET_STORE_DIR ||
      path.resolve(process.cwd(), "test-assets/publishing"),
    // Local immutable store for generated manual-export archives. The API
    // exposes files through an ownership-checked download endpoint, so this
    // filesystem path is never returned to clients.
    exportStoreDir:
      process.env.PUBLISHING_EXPORT_STORE_DIR ||
      path.resolve(process.cwd(), ".publishing-exports"),
    // ── Issue #175 credential vault ─────────────────────────────────────
    // AES-256-GCM encryption key for per-business provider credentials
    // (32 bytes, hex). Deployment secret — never a customer Page token.
    vaultKey: process.env.PUBLISHING_VAULT_KEY || "",
    // Version tag written on every encrypted record (rotation seam).
    vaultKeyVersion: process.env.PUBLISHING_VAULT_KEY_VERSION || "v1",
    // Previously active key versions (JSON map version → hex key) accepted for
    // decryption only — used by the rotation script to re-encrypt records.
    vaultPreviousKeys: process.env.PUBLISHING_VAULT_PREVIOUS_KEYS || "{}",
    // HMAC secret signing short-lived provider-fetch URLs for Instagram media.
    // Deployment secret; fail-closed when empty and an IG publish is attempted.
    mediaFetchSecret: process.env.PUBLISHING_MEDIA_FETCH_SECRET || "",
    // Publicly reachable base URL Meta's Graph API can fetch media from
    // (registered HTTPS host in production). Defaults to the callback base for
    // local development.
    mediaFetchBaseUrl:
      process.env.PUBLISHING_MEDIA_FETCH_BASE_URL ||
      process.env.PUBLISHING_CALLBACK_BASE_URL ||
      "http://localhost:3001",
    // Short-lived provider-fetch URL window (ms).
    mediaFetchTtlMs: parseInt(
      process.env.PUBLISHING_MEDIA_FETCH_TTL_MS || "900000",
      10,
    ),
    // One-time OAuth state lifetime (ms).
    metaOAuthStateTtlMs: parseInt(
      process.env.PUBLISHING_META_OAUTH_STATE_TTL_MS || "600000",
      10,
    ),
    // Origin the API-owned Meta callback redirects the browser back to after
    // the OAuth round trip (issue #175). Never carries tokens — only a
    // connection result id or sanitized result code.
    webBaseUrl:
      process.env.PUBLISHING_WEB_BASE_URL ||
      process.env.WEB_ORIGIN ||
      "http://localhost:3000",
  },

  meta: {
    // MarketMind Meta app configuration — STATIC deployment secrets. Never a
    // per-business Page token (issue #175).
    appId: process.env.META_APP_ID || "",
    appSecret: process.env.META_APP_SECRET || "",
    // Registered HTTPS redirect URI for the API-owned GET callback.
    redirectUri: process.env.META_REDIRECT_URI || "",
    graphBaseUrl:
      process.env.META_GRAPH_BASE_URL || "https://graph.facebook.com",
    graphVersion: process.env.META_GRAPH_VERSION || "v21.0",
    // Bounded Graph API timeout for server-side calls (ms).
    requestTimeoutMs: parseInt(
      process.env.META_REQUEST_TIMEOUT_MS || "15000",
      10,
    ),
  },

  billing: {
    // Keep the fake provider as the default. A live Paymob/Geidea secret must
    // be supplied only after the merchant procurement gate is complete.
    fakeWebhookSecret:
      process.env.BILLING_FAKE_WEBHOOK_SECRET ||
      "marketmind-development-billing-webhook",
    provider: process.env.BILLING_PROVIDER || "fake",
    paymob: {
      baseUrl: process.env.PAYMOB_BASE_URL || "https://accept.paymob.com",
      apiKey: process.env.PAYMOB_API_KEY || "",
      publicKey: process.env.PAYMOB_PUBLIC_KEY || "",
      integrationIds: (process.env.PAYMOB_INTEGRATION_IDS || "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
      hmacSecret: process.env.PAYMOB_HMAC_SECRET || "",
      timeoutMs:
        parseInt(process.env.PAYMOB_TIMEOUT_MS || "15000", 10) || 15000,
      sandbox: process.env.PAYMOB_SANDBOX === "true",
    },
  },
});
