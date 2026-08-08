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
  private readonly ttlMs: number;

  constructor(config: ConfigService) {
    this.secret = config.get<string>("publishing.mediaFetchSecret", "");
    this.baseUrl = config.get<string>(
      "publishing.mediaFetchBaseUrl",
      "http://localhost:3001",
    );
    this.ttlMs =
      parseInt(
        config.get<string>("publishing.mediaFetchTtlMs", "900000"),
        10,
      ) || 900000;
  }

  isConfigured(): boolean {
    return Boolean(this.secret);
  }

  /** Publicly reachable, short-lived media URL for the exact attempt + asset. */
  buildUrl(input: { attemptId: string; assetId: string }): string {
    if (!this.secret) {
      throw new Error("PUBLISHING_MEDIA_FETCH_SECRET is not configured");
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
}
