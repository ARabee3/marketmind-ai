import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as crypto from "crypto";

/**
 * Short-lived provider-fetch URL signing (issue #175).
 *
 * Instagram's Graph API media container requires a publicly fetchable
 * `image_url`. The executor hands Meta a URL signed with an HMAC that is
 * BOUND to the exact attempt + asset and expires quickly, so a leaked URL is
 * useless after the window. The secret is a deployment secret
 * (`PUBLISHING_MEDIA_FETCH_SECRET`); the service fails closed when unset.
 */
@Injectable()
export class MediaFetchTokenService {
  private readonly logger = new Logger(MediaFetchTokenService.name);
  private readonly secret: string;
  private readonly baseUrl: string;
  private readonly baseUrlValue: URL | null;
  private readonly nodeEnv: string;
  private readonly ttlMs: number;

  constructor(config: ConfigService) {
    this.secret = config.get<string>("publishing.mediaFetchSecret", "");
    this.baseUrl = config
      .get<string>("publishing.mediaFetchBaseUrl", "")
      .trim()
      .replace(/\/+$/, "");
    this.baseUrlValue = this.parseBaseUrl(this.baseUrl);
    this.nodeEnv = config.get<string>("app.nodeEnv", "development");
    this.ttlMs =
      parseInt(
        config.get<string>("publishing.mediaFetchTtlMs", "900000"),
        10,
      ) || 900000;
  }

  isConfigured(): boolean {
    return this.configurationError() === null;
  }

  /**
   * Returns a deployment-safe explanation without including the HMAC secret.
   * Production real publishing requires an HTTPS URL that Meta can fetch;
   * local HTTP URLs remain valid for development and integration tests.
   */
  configurationError(): string | null {
    if (!this.secret) return "PUBLISHING_MEDIA_FETCH_SECRET is not configured";
    if (!this.baseUrlValue) {
      return "PUBLISHING_MEDIA_FETCH_BASE_URL must be an absolute HTTP(S) URL";
    }
    if (
      this.baseUrlValue.username ||
      this.baseUrlValue.password ||
      this.baseUrlValue.pathname !== "/" ||
      this.baseUrlValue.search ||
      this.baseUrlValue.hash
    ) {
      return "PUBLISHING_MEDIA_FETCH_BASE_URL must contain only an origin";
    }
    if (
      !["development", "test"].includes(this.nodeEnv) &&
      this.baseUrlValue.protocol !== "https:"
    ) {
      return "PUBLISHING_MEDIA_FETCH_BASE_URL must use HTTPS outside development and test";
    }
    return null;
  }

  /**
   * Stricter pre-dispatch check for REAL image publishing (issue #240).
   *
   * `configurationError()` deliberately accepts loopback HTTP in development
   * so integration tests can exercise the signing/verification path. But Meta
   * itself cannot fetch a loopback or private address, so a real image
   * publication that passes `configurationError()` can still fail at the
   * provider with a generic 4xx collapsed into PUBLISHING_PROVIDER_FAILURE.
   *
   * This method returns `null` only when the configured origin is suitable
   * for provider fetch: public HTTPS (or an HTTPS tunnel whose hostname is
   * not loopback/private). A loopback, private, or non-HTTPS origin returns a
   * specific safe explanation the owner can act on, and the caller must block
   * the dispatch with `PUBLISHING_MEDIA_ORIGIN_NOT_REACHABLE`.
   */
  providerFetchOriginError(): string | null {
    const base = this.configurationError();
    if (base) return base;
    const url = this.baseUrlValue;
    if (url.protocol !== "https:") {
      return "PUBLISHING_MEDIA_FETCH_BASE_URL must use HTTPS for real image publishing (Meta cannot fetch HTTP origins)";
    }
    if (isLoopbackOrPrivateHost(url.hostname)) {
      return "PUBLISHING_MEDIA_FETCH_BASE_URL must be publicly reachable for real image publishing (Meta cannot fetch loopback or private addresses)";
    }
    return null;
  }

  /** Publicly reachable, short-lived media URL for the exact attempt + asset. */
  buildUrl(input: { attemptId: string; assetId: string }): string {
    const configurationError = this.configurationError();
    if (configurationError) {
      throw new Error(configurationError);
    }
    const exp = Date.now() + this.ttlMs;
    const token = this.sign(input, exp);
    const params = new URLSearchParams({
      token,
      attempt: input.attemptId,
      exp: String(exp),
    });
    return `${this.baseUrl}/internal/v1/publishing/media-fetch/${encodeURIComponent(input.assetId)}?${params.toString()}`;
  }

  /** Verifies the token binds the exact attempt+asset and is still fresh. */
  verify(input: {
    token: string;
    attemptId: string;
    assetId: string;
    expMs: number;
  }): boolean {
    if (!this.secret) return false;
    const expected = this.sign(
      { attemptId: input.attemptId, assetId: input.assetId },
      input.expMs,
    );
    const a = Buffer.from(expected);
    const b = Buffer.from(input.token);
    if (a.length !== b.length) return false;
    const ok = crypto.timingSafeEqual(a, b);
    if (!ok) return false;
    return input.expMs > Date.now();
  }

  private sign(
    input: { attemptId: string; assetId: string },
    expMs: number,
  ): string {
    const payload = `${input.attemptId}.${input.assetId}.${expMs}`;
    const sig = crypto
      .createHmac("sha256", this.secret)
      .update(payload, "utf8")
      .digest("base64url");
    return `${expMs}.${sig}`;
  }

  private parseBaseUrl(value: string): URL | null {
    if (!value) return null;
    try {
      const parsed = new URL(value);
      return parsed.protocol === "http:" || parsed.protocol === "https:"
        ? parsed
        : null;
    } catch {
      return null;
    }
  }
}

/**
 * Returns true for hostnames Meta cannot fetch: the `localhost` label, IPv4
 * loopback/private/link-local ranges, and IPv6 loopback/ULA/link-local ranges.
 * A public hostname or a public IP returns false. DNS resolution is not
 * performed at runtime (unreliable and slow), so a hostname that resolves to
 * a private IP is not caught here — the configured origin is expected to be
 * an explicit public host or an HTTPS tunnel in local development.
 */
function isLoopbackOrPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === "localhost") return true;

  // IPv4 dotted-quad.
  const v4 = host.split(".").map(Number);
  if (
    v4.length === 4 &&
    v4.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255)
  ) {
    const [a, b] = v4;
    if (a === 127) return true; // 127.0.0.0/8 loopback
    if (a === 10) return true; // 10.0.0.0/8 private
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
    if (a === 192 && b === 168) return true; // 192.168.0.0/16 private
    if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local
    if (a === 0) return true; // 0.0.0.0/8 "this host"
    return false;
  }

  // IPv6 — strip zone id and surrounding brackets.
  const v6 = host.replace(/^\[|\]$/g, "").split("%")[0];
  if (v6 === "::1") return true; // loopback
  if (v6 === "::" || v6 === "0:0:0:0:0:0:0:0") return true; // unspecified
  // Unique local addresses fc00::/7 → hex groups start with fc or fd.
  if (/^f[cd][0-9a-f]{2}(?::|$)/.test(v6)) return true;
  // Link-local fe80::/10.
  if (/^fe[89ab][0-9a-f](?::|$)/.test(v6)) return true;

  return false;
}
