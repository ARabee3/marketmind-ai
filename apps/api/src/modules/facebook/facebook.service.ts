import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import axios from "axios";

import { PrismaService } from "../../common/persistence/prisma.service";
import { MailService } from "../mail/mail.service";
import { facebookSocialConnectionRef } from "../publishing/targets/facebook-target-ref";
import { EncryptionService } from "./encryption.service";
import { FacebookOAuthStateStore } from "./facebook-oauth-state.store";

/** Least-privilege Facebook Page permissions, including read-only Insights. */
export const FACEBOOK_SCOPES: readonly string[] = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_posts",
  "read_insights",
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
  expiresAt: Date | null;
}

export type FacebookCallbackResult =
  | { ok: true; pageName: string }
  | { ok: false; error: string };

export interface FacebookPhotoPublishResult {
  remotePublicationId: string;
  remoteUrl: string | null;
}

export type PublishResult =
  | { success: true; postId: string }
  | { success: false; reason: "expired" }
  | { success: false; reason: "error"; message: string };

/** Sanitized Graph failure used by the approval/dispatch executor. */
export class FacebookGraphError extends Error {
  constructor(
    readonly status: number,
    readonly code: number,
    message: string,
    readonly errorSubcode?: number,
  ) {
    super(message.replace(/\s+/g, " ").slice(0, 500));
    this.name = "FacebookGraphError";
  }
}

export interface FacebookPagePublishInput {
  readonly userId: string;
  readonly pageId: string;
  readonly caption: string;
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
 * random token bound to the user and stored as a short-lived, single-use
 * Redis value; the callback validates and consumes it before any code
 * exchange. Token validity is checked reactively (at publish/test time):
 * Graph error code 190 invalidates the connection and triggers the reconnect
 * email.
 */
@Injectable()
export class FacebookService {
  private readonly logger = new Logger(FacebookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly encryption: EncryptionService,
    private readonly mailer: MailService,
    private readonly oauthStateStore: FacebookOAuthStateStore,
  ) {}

  /**
   * Builds the Facebook OAuth dialog URL for an authenticated user. The
   * generated `state` is stored briefly so the callback can verify it and
   * resolve the owning user.
   */
  async buildAuthorizationUrl(userId: string): Promise<string> {
    const appId = this.config.get<string>("facebook.appId") ?? "";
    const redirectUri = this.config.get<string>("facebook.redirectUri") ?? "";
    const graphVersion =
      this.config.get<string>("facebook.graphVersion") ?? "v20.0";

    if (!appId || !redirectUri) {
      throw new Error("Facebook app configuration is missing");
    }

    const state = await this.oauthStateStore.createOAuthState(userId);

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
  createStartSession(userId: string): Promise<string> {
    return this.oauthStateStore.createStartSession(userId);
  }

  /** Validates and consumes a start session token; returns the userId. */
  consumeStartSession(token: string | undefined): Promise<string | null> {
    return this.oauthStateStore.consumeStartSession(token);
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
    const userId = await this.oauthStateStore.consumeOAuthState(state);
    if (!userId) {
      this.logger.warn("Facebook OAuth callback with invalid or expired state");
      return {
        ok: false,
        error: "The connection request expired. Please try again.",
      };
    }

    try {
      const exchange = await this.exchangeCodeForLongLivedToken(code);
      const page = await this.fetchFirstPage(exchange.token);

      const encrypted = this.encryption.encrypt(page.accessToken);
      await this.prisma.socialConnection.upsert({
        where: { userId },
        create: {
          userId,
          provider: "facebook",
          pageId: page.id,
          pageName: page.name,
          encryptedToken: encrypted.ciphertext,
          encryptionIv: encrypted.iv,
          authTag: encrypted.authTag,
          isValid: true,
          connectedAt: new Date(),
          expiresAt: exchange.expiresAt,
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
          expiresAt: exchange.expiresAt,
        },
      });

      this.logger.log(
        `Facebook Page "${page.name}" connected for user ${userId}`,
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
      expiresAt: connection.expiresAt,
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

  /**
   * Provider-facing Facebook text publish. Unlike the owner test route this
   * method preserves a sanitized Graph error so the publishing executor can
   * classify it as failed versus unknown without exposing token material.
   */
  async publishTextForUser(input: FacebookPagePublishInput): Promise<{
    remotePublicationId: string;
    remoteUrl: string | null;
  }> {
    try {
      const pageToken = await this.pageTokenForUser(input.userId, input.pageId);
      const response = await axios.post(this.graphUrl(`${input.pageId}/feed`), {
        message: input.caption,
        access_token: pageToken,
      });
      const remotePublicationId = String(response.data?.id ?? "");
      if (!remotePublicationId) {
        throw new FacebookGraphError(
          200,
          0,
          "page feed response carried no post id",
        );
      }
      await this.markConnectionTested(input.userId);
      return {
        remotePublicationId,
        remoteUrl: await this.permalinkForPagePost(
          remotePublicationId,
          pageToken,
        ),
      };
    } catch (error) {
      await this.invalidateOnExpiredToken(input.userId, error);
      throw this.normalizeGraphError(error);
    }
  }

  /** Provider-facing Facebook image publish using PR #193's connection. */
  async publishPhotoForUser(input: {
    userId: string;
    pageId: string;
    imageUrl: string;
    caption: string;
  }): Promise<FacebookPhotoPublishResult> {
    try {
      const pageToken = await this.pageTokenForUser(input.userId, input.pageId);

      const result = await this.publishPhotoViaPageToken({
        pageToken,
        pageId: input.pageId,
        imageUrl: input.imageUrl,
        caption: input.caption,
      });
      await this.markConnectionTested(input.userId);
      return result;
    } catch (error) {
      await this.invalidateOnExpiredToken(input.userId, error);
      throw this.normalizeGraphError(error);
    }
  }

  /**
   * Runs an API-owned provider operation with the connected Page token without
   * ever returning the token to a controller, queue payload, or browser. This
   * is the credential boundary used by Facebook performance synchronization.
   */
  async withPageTokenForUser<T>(
    input: {
      readonly userId: string;
      readonly pageId: string;
    },
    operation: (pageToken: string) => Promise<T>,
  ): Promise<T> {
    const pageToken = await this.pageTokenForUser(input.userId, input.pageId);
    try {
      return await operation(pageToken);
    } catch (error) {
      await this.invalidateOnExpiredToken(input.userId, error);
      throw error;
    }
  }

  /**
   * Deletes the user's SocialConnection row and expires any bridged publishing
   * target that still references it, so a stale target can never remain
   * selectable or approvable after the owner disconnects.
   */
  async disconnect(userId: string): Promise<void> {
    const connection = await this.prisma.socialConnection.findUnique({
      where: { userId },
      select: { id: true },
    });

    if (connection) {
      const reference = facebookSocialConnectionRef(connection.id);
      const expired = await this.prisma.publishingTarget.updateMany({
        where: {
          credentialRef: reference,
          connectionState: "CONNECTED",
        },
        data: {
          connectionState: "EXPIRED",
          version: { increment: 1 },
        },
      });
      if (expired.count > 0) {
        this.logger.log(
          `Expired ${expired.count} bridged Facebook publishing target(s) on disconnect`,
        );
      }
    }

    await this.prisma.socialConnection.deleteMany({
      where: { userId },
    });
  }

  /**
   * Stateless Facebook Page photo publish via a raw Page token (used by the
   * publishing pipeline through MetaGraphClient). No SocialConnection lookup
   * — the caller is responsible for token resolution (e.g. from the vault).
   *
   * Throws on Graph API errors so the pipeline's error normalisation
   * (MetaGraphClientError) can wrap them.
   */
  async publishPhotoViaPageToken(params: {
    pageToken: string;
    pageId: string;
    imageUrl: string;
    caption: string;
  }): Promise<FacebookPhotoPublishResult> {
    const response = await axios.post<{ id?: string; post_id?: string }>(
      this.graphUrl(`${params.pageId}/photos`),
      null,
      {
        params: {
          url: params.imageUrl,
          caption: params.caption,
          published: "true",
          access_token: params.pageToken,
        },
      },
    );
    const remotePublicationId = String(
      response.data?.post_id || response.data?.id || "",
    );
    if (!remotePublicationId) {
      throw new Error("page photos response carried no post id");
    }
    let remoteUrl: string | null = null;
    try {
      const linkResponse = await axios.get<{
        permalink_url?: string;
        link?: string;
      }>(this.graphUrl(String(remotePublicationId)), {
        params: {
          fields: "permalink_url,link",
          access_token: params.pageToken,
        },
      });
      remoteUrl =
        linkResponse.data?.permalink_url ?? linkResponse.data?.link ?? null;
    } catch (error) {
      // Permalink is best-effort after a confirmed publish.
      this.logger.warn(
        `Facebook permalink lookup failed for ${remotePublicationId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    return { remotePublicationId, remoteUrl };
  }

  /** Resolves a Page token without returning it to a controller or browser. */
  private async pageTokenForUser(
    userId: string,
    pageId: string,
  ): Promise<string> {
    const connection = await this.prisma.socialConnection.findUnique({
      where: { userId },
    });
    if (!connection || connection.provider !== "facebook") {
      throw new FacebookGraphError(
        401,
        FACEBOOK_INVALID_TOKEN_CODE,
        "Facebook Page connection is not available for this target",
      );
    }
    if (!connection.isValid || connection.pageId !== pageId) {
      throw new FacebookGraphError(
        401,
        FACEBOOK_INVALID_TOKEN_CODE,
        "Facebook Page connection is not valid for this target",
      );
    }
    try {
      return this.encryption.decrypt(
        connection.encryptedToken,
        connection.encryptionIv,
        connection.authTag,
      );
    } catch {
      throw new FacebookGraphError(
        0,
        0,
        "Facebook Page credential could not be read",
      );
    }
  }

  private async markConnectionTested(userId: string): Promise<void> {
    await this.prisma.socialConnection.update({
      where: { userId },
      data: { lastTestedAt: new Date() },
    });
  }

  private async invalidateOnExpiredToken(
    userId: string,
    error: unknown,
  ): Promise<void> {
    const isExpired =
      error instanceof FacebookGraphError
        ? error.code === FACEBOOK_INVALID_TOKEN_CODE
        : this.isGraphErrorCode(error, FACEBOOK_INVALID_TOKEN_CODE);
    if (!isExpired) return;
    const invalidated = await this.prisma.socialConnection.updateMany({
      where: { userId },
      data: { isValid: false },
    });
    if (invalidated.count > 0) {
      await this.mailer.sendFacebookExpiredEmail(userId);
    }
  }

  private normalizeGraphError(error: unknown): FacebookGraphError {
    if (error instanceof FacebookGraphError) return error;
    if (axios.isAxiosError(error)) {
      const data = error.response?.data as {
        error?: { code?: number; error_subcode?: number; message?: string };
      };
      return new FacebookGraphError(
        error.response?.status ?? 0,
        Number(data?.error?.code ?? 0),
        data?.error?.message ?? "Facebook Graph request failed",
        data?.error?.error_subcode
          ? Number(data.error.error_subcode)
          : undefined,
      );
    }
    if (error instanceof NotFoundException) throw error;
    return new FacebookGraphError(
      0,
      0,
      error instanceof Error ? error.message : "Facebook Graph request failed",
    );
  }

  private async permalinkForPagePost(
    postId: string,
    pageToken: string,
  ): Promise<string | null> {
    try {
      const response = await axios.get<{
        permalink_url?: string;
        link?: string;
      }>(this.graphUrl(postId), {
        params: {
          fields: "permalink_url,link",
          access_token: pageToken,
        },
      });
      return response.data?.permalink_url ?? response.data?.link ?? null;
    } catch (error) {
      this.logger.warn(
        `Facebook permalink lookup failed for ${postId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }

  private async exchangeCodeForLongLivedToken(code: string): Promise<{
    token: string;
    expiresAt: Date | null;
  }> {
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

    const longLived = await axios.get<{
      access_token?: string;
      expires_in?: number;
    }>(this.graphUrl("oauth/access_token"), {
      params: {
        grant_type: "fb_exchange_token",
        client_id: appId,
        client_secret: appSecret,
        fb_exchange_token: shortToken,
      },
    });
    const longToken = longLived.data?.access_token;
    if (!longToken) {
      throw new Error("No access_token returned from token exchange");
    }
    const expiresInSeconds = longLived.data?.expires_in;
    const expiresAt =
      Number.isFinite(expiresInSeconds) && (expiresInSeconds as number) > 0
        ? new Date(Date.now() + (expiresInSeconds as number) * 1000)
        : null;
    return { token: longToken, expiresAt };
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
    const base =
      this.config.get<string>("facebook.graphBaseUrl") ??
      "https://graph.facebook.com";
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
