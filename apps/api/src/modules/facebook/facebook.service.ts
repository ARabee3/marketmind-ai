import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import axios from "axios";
import * as crypto from "crypto";

import { PrismaService } from "../../common/persistence/prisma.service";
import { MailService } from "../mail/mail.service";
import { EncryptionService } from "./encryption.service";

/** Least-privilege Facebook Page permissions (dev milestone). */
export const FACEBOOK_SCOPES: readonly string[] = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_posts",
];

/** Graph API error code for invalid/expired/revoked OAuth tokens. */
export const FACEBOOK_INVALID_TOKEN_CODE = 190;

export const FACEBOOK_TEST_MESSAGE =
  "✅ MarketMind AI test post — connection verified.";

export interface FacebookConnectionView {
  provider: string;
  pageName: string;
  isValid: boolean;
  connectedAt: Date;
  lastTestedAt: Date | null;
}

export type FacebookCallbackResult =
  | { ok: true; pageName: string }
  | { ok: false; error: string };

export type PublishResult =
  | { success: true; postId: string }
  | { success: false; reason: "expired" }
  | { success: false; reason: "error"; message: string };

interface PendingOAuthState {
  userId: string;
  expiresAt: number;
}

interface PendingStartSession {
  userId: string;
  expiresAt: number;
}

/**
 * Facebook Page connection service (one Page per user, dev milestone).
 *
 * The OAuth dialog is opened from a popup, which is a plain browser
 * navigation and therefore cannot carry the Bearer access token. Identity is
 * delivered with a short-lived, single-use start session: the web app first
 * calls `POST /auth/facebook/start` (Bearer-authenticated) which returns a
 * random one-time token stored in an HttpOnly cookie; the popup then opens
 * `GET /auth/facebook/start`, which consumes that token, resolves the owning
 * user, and redirects to Facebook.
 *
 * The `state` parameter sent to Facebook is a separate cryptographically
 * random token bound to the user and stored briefly in memory; the callback
 * validates and consumes it before any code exchange. Token validity is
 * checked reactively (at publish/test time): Graph error code 190
 * invalidates the connection and triggers the reconnect email.
 *
 * DEV MILESTONE NOTE: Both `oauthStates` and `startSessions` are stored in
 * plain in-memory Maps. This means:
 * - Server restarts lose all in-progress OAuth flows.
 * - Deploying multiple instances breaks OAuth (state created on instance A
 *   is not visible on instance B, where Facebook redirects the callback).
 * Migrate to Redis-backed storage before any multi-instance production
 * deployment.
 */
@Injectable()
export class FacebookService {
  // DEV MILESTONE: in-memory Maps — migrate to Redis for production.
  private readonly logger = new Logger(FacebookService.name);
  private readonly stateTtlMs = 10 * 60 * 1000;
  private readonly oauthStates = new Map<string, PendingOAuthState>();
  private readonly startSessions = new Map<string, PendingStartSession>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly encryption: EncryptionService,
    private readonly mailer: MailService,
  ) {}

  /**
   * Builds the Facebook OAuth dialog URL for an authenticated user. The
   * generated `state` is stored briefly so the callback can verify it and
   * resolve the owning user.
   */
  buildAuthorizationUrl(userId: string): string {
    const appId = this.config.get<string>("facebook.appId") ?? "";
    const redirectUri = this.config.get<string>("facebook.redirectUri") ?? "";
    const graphVersion = this.config.get<string>("facebook.graphVersion") ?? "v20.0";

    if (!appId || !redirectUri) {
      throw new Error("Facebook app configuration is missing");
    }

    const state = crypto.randomBytes(24).toString("base64url");
    this.oauthStates.set(state, {
      userId,
      expiresAt: Date.now() + this.stateTtlMs,
    });

    const params = new URLSearchParams({
      client_id: appId,
      redirect_uri: redirectUri,
      state,
      scope: FACEBOOK_SCOPES.join(","),
    });
    return `https://www.facebook.com/${graphVersion}/dialog/oauth?${params.toString()}`;
  }

  /**
   * Creates a short-lived, single-use start session token bound to the user.
   * The value is placed in an HttpOnly cookie by the controller so the
   * popup's GET /auth/facebook/start can identify the user without carrying
   * an Authorization header.
   */
  createStartSession(userId: string): string {
    const token = crypto.randomBytes(32).toString("base64url");
    this.startSessions.set(token, {
      userId,
      expiresAt: Date.now() + this.stateTtlMs,
    });
    return token;
  }

  /** Validates and consumes a start session token; returns the userId. */
  consumeStartSession(token: string | undefined): string | null {
    if (!token) return null;
    const session = this.startSessions.get(token);
    this.startSessions.delete(token);
    if (!session || session.expiresAt < Date.now()) return null;
    return session.userId;
  }

  /**
   * Validates the OAuth state, exchanges the authorization code for a
   * long-lived user token, resolves the user's first Page, encrypts the Page
   * access token, and upserts the SocialConnection row for that user.
   */
  async handleCallback(
    code: string,
    state: string,
  ): Promise<FacebookCallbackResult> {
    const pending = this.consumeState(state);
    if (!pending) {
      this.logger.warn("Facebook OAuth callback with invalid or expired state");
      return { ok: false, error: "The connection request expired. Please try again." };
    }

    try {
      const longLivedToken = await this.exchangeCodeForLongLivedToken(code);
      const page = await this.fetchFirstPage(longLivedToken);

      const encrypted = this.encryption.encrypt(page.accessToken);
      await this.prisma.socialConnection.upsert({
        where: { userId: pending.userId },
        create: {
          userId: pending.userId,
          provider: "facebook",
          pageId: page.id,
          pageName: page.name,
          encryptedToken: encrypted.ciphertext,
          encryptionIv: encrypted.iv,
          authTag: encrypted.authTag,
          isValid: true,
          connectedAt: new Date(),
        },
        update: {
          provider: "facebook",
          pageId: page.id,
          pageName: page.name,
          encryptedToken: encrypted.ciphertext,
          encryptionIv: encrypted.iv,
          authTag: encrypted.authTag,
          isValid: true,
          connectedAt: new Date(),
          lastTestedAt: null,
        },
      });

      this.logger.log(
        `Facebook Page "${page.name}" connected for user ${pending.userId}`,
      );
      return { ok: true, pageName: page.name };
    } catch (error) {
      this.logger.error(
        `Facebook OAuth exchange failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return {
        ok: false,
        error: "We could not connect your Facebook Page. Please try again.",
      };
    }
  }

  /** Returns the current user's connection view, or null when none exists. */
  async getConnection(userId: string): Promise<FacebookConnectionView | null> {
    const connection = await this.prisma.socialConnection.findUnique({
      where: { userId },
    });
    if (!connection) return null;
    return {
      provider: connection.provider,
      pageName: connection.pageName,
      isValid: connection.isValid,
      connectedAt: connection.connectedAt,
      lastTestedAt: connection.lastTestedAt,
    };
  }

  /**
   * Publishes a test post to the user's connected Page. Reuses the same
   * shared `publishPost` logic used by future scheduled publishing.
   */
  async testConnection(userId: string): Promise<PublishResult> {
    return this.publishPost(userId, FACEBOOK_TEST_MESSAGE);
  }

  /**
   * Shared publish logic: decrypt the stored Page token and POST to the Graph
   * API feed. On error code 190 the connection is marked invalid and the
   * reconnect email is triggered. Called by the test route AND by any future
   * scheduled-publishing code — do not duplicate this logic elsewhere.
   */
  async publishPost(userId: string, message: string): Promise<PublishResult> {
    const connection = await this.prisma.socialConnection.findUnique({
      where: { userId },
    });
    if (!connection) {
      throw new NotFoundException("No Facebook connection for this user");
    }

    const pageToken = this.encryption.decrypt(
      connection.encryptedToken,
      connection.encryptionIv,
      connection.authTag,
    );

    try {
      const response = await axios.post(
        this.graphUrl(`${connection.pageId}/feed`),
        { message, access_token: pageToken },
      );
      await this.prisma.socialConnection.update({
        where: { userId },
        data: { lastTestedAt: new Date() },
      });
      return { success: true, postId: String(response.data?.id ?? "") };
    } catch (error) {
      if (this.isGraphErrorCode(error, FACEBOOK_INVALID_TOKEN_CODE)) {
        await this.prisma.socialConnection.update({
          where: { userId },
          data: { isValid: false },
        });
        await this.mailer.sendFacebookExpiredEmail(userId);
        return { success: false, reason: "expired" };
      }
      const messageText =
        axios.isAxiosError(error) && error.response?.data
          ? JSON.stringify(error.response.data)
          : error instanceof Error
            ? error.message
            : String(error);
      return { success: false, reason: "error", message: messageText };
    }
  }

  /** Deletes the user's SocialConnection row. */
  async disconnect(userId: string): Promise<void> {
    await this.prisma.socialConnection.deleteMany({
      where: { userId },
    });
  }

  private consumeState(state: string): PendingOAuthState | null {
    const pending = this.oauthStates.get(state);
    if (!pending) return null;
    this.oauthStates.delete(state);
    if (pending.expiresAt < Date.now()) return null;
    return pending;
  }

  private async exchangeCodeForLongLivedToken(code: string): Promise<string> {
    const appId = this.config.get<string>("facebook.appId") ?? "";
    const appSecret = this.config.get<string>("facebook.appSecret") ?? "";
    const redirectUri = this.config.get<string>("facebook.redirectUri") ?? "";

    const shortLived = await axios.get<{ access_token?: string }>(
      this.graphUrl("oauth/access_token"),
      {
        params: {
          client_id: appId,
          client_secret: appSecret,
          redirect_uri: redirectUri,
          code,
        },
      },
    );
    const shortToken = shortLived.data?.access_token;
    if (!shortToken) {
      throw new Error("No access_token returned for the authorization code");
    }

    const longLived = await axios.get<{ access_token?: string }>(
      this.graphUrl("oauth/access_token"),
      {
        params: {
          grant_type: "fb_exchange_token",
          client_id: appId,
          client_secret: appSecret,
          fb_exchange_token: shortToken,
        },
      },
    );
    const longToken = longLived.data?.access_token;
    if (!longToken) {
      throw new Error("No access_token returned from token exchange");
    }
    return longToken;
  }

  private async fetchFirstPage(longLivedToken: string): Promise<{
    id: string;
    name: string;
    accessToken: string;
  }> {
    const response = await axios.get<{
      data?: Array<{ id?: string; name?: string; access_token?: string }>;
    }>(this.graphUrl("me/accounts"), {
      params: { access_token: longLivedToken },
    });
    const pages = response.data?.data ?? [];
    const first = pages.find(
      (page) => page.id && page.name && page.access_token,
    );
    if (!first) {
      throw new Error("No Facebook Page found for this account");
    }
    return {
      id: first.id as string,
      name: first.name as string,
      accessToken: first.access_token as string,
    };
  }

  private graphUrl(path: string): string {
    const base = this.config.get<string>("facebook.graphBaseUrl") ?? "https://graph.facebook.com";
    const version = this.config.get<string>("facebook.graphVersion") ?? "v20.0";
    return `${base}/${version}/${path}`;
  }

  private isGraphErrorCode(error: unknown, code: number): boolean {
    if (axios.isAxiosError(error)) {
      const errorCode = (error.response?.data as { error?: { code?: number } })
        ?.error?.code;
      return errorCode === code;
    }
    return false;
  }
}
