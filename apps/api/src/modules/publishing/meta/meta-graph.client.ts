import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { HttpService } from "@nestjs/axios";
import { firstValueFrom } from "rxjs";
import type { AxiosError } from "axios";

import { FacebookService } from "../../facebook/facebook.service";

/**
 * Least-privilege Meta permission matrix (issue #175).
 *
 * Recorded against current Meta Graph API developer documentation at
 * implementation time. First release needs ONLY what is required to:
 *   1. discover Pages the authorizing owner can use         → pages_show_list
 *   2. read the selected Page identity/capability           → pages_manage_posts
 *   3. publish the Facebook Page static-image operation     → pages_manage_posts
 *   4. read the linked Instagram Professional account
 *      identity/capability                                  → instagram_basic
 *   5. publish the Instagram Professional static-image op   → instagram_content_publish
 *
 * `pages_read_engagement` is required for Page engagement/Insights access and
 * the Instagram Graph API resolves the linked Business Account through the
 * Page access token. `read_insights` is requested for the Facebook-only
 * performance slice. Nothing else is requested: no ads, messaging, or
 * webhooks permissions. A production Meta app additionally requires a
 * registered HTTPS
 * redirect URI, public/live app mode, and any Meta App Review /
 * business-verification approvals — those live prerequisites are reported as
 * honest blockers, never faked. The matrix must be re-verified against the
 * current official docs before any production launch.
 */
export const META_LEAST_PRIVILEGE_SCOPES: readonly string[] = [
  "pages_show_list",
  "pages_manage_posts",
  "pages_read_engagement",
  "read_insights",
  "instagram_basic",
  "instagram_content_publish",
];

/** Stable Meta authorization-denial reasons surfaced to the owner UI. */
export const META_PERMISSION_STATUS_GRANTED = "granted";
export const META_PERMISSION_PAGES_READ_ENGAGEMENT = "pages_read_engagement";
export const META_PERMISSION_READ_INSIGHTS = "read_insights";

/**
 * Frozen Facebook post Insights allowlist from the credential-redacted live
 * decision recorded in `fixtures/facebook-insights-live-v1.json` (2026-08-18).
 * Graph v21.0 is retained as the publishing default after an identical v26.0
 * comparison. Deprecated reach/impression metrics remain intentionally out.
 */
export const META_FACEBOOK_INSIGHTS_METRICS = [
  "post_media_view",
  "post_total_media_view_unique",
  "post_clicks",
] as const;

export type MetaFacebookInsightValue = number | Record<string, number>;

export interface MetaFacebookInsightValuePoint {
  readonly value: MetaFacebookInsightValue;
  readonly endTime: string | null;
}

export interface MetaFacebookInsightMetric {
  readonly name: string;
  readonly period: string | null;
  readonly values: readonly MetaFacebookInsightValuePoint[];
}

export interface MetaFacebookPostInsights {
  readonly postId: string;
  readonly metrics: readonly MetaFacebookInsightMetric[];
}

export interface MetaGraphErrorInfo {
  readonly status: number;
  readonly code: number;
  readonly errorSubcode?: number;
  readonly message: string;
}

/** Normalized Graph API failure. `message` is sanitized (no token material). */
export class MetaGraphClientError extends Error {
  constructor(readonly info: MetaGraphErrorInfo) {
    super(`meta graph ${info.status} code=${info.code}`);
    this.name = "MetaGraphClientError";
  }
}

export interface MetaLongLivedUserToken {
  readonly accessToken: string;
  readonly expiresAt: Date;
  readonly userId: string | null;
  readonly userName: string | null;
}

export interface MetaLinkedInstagramAccount {
  readonly id: string;
  readonly username: string;
  readonly name: string;
}

export interface MetaPageAccount {
  readonly pageId: string;
  readonly name: string;
  /** Present only when the owner can act on the page (pages_manage_posts). */
  readonly accessToken: string | null;
  readonly instagramBusinessAccount: MetaLinkedInstagramAccount | null;
}

export interface MetaGrantedPermission {
  readonly permission: string;
  readonly status: string;
}

export interface MetaPublishResult {
  readonly remotePublicationId: string;
  readonly remoteUrl: string | null;
}

/**
 * API-owned Meta Graph client (issue #175). Every token exchange, Page
 * discovery, capability verification, and Graph API call happens here,
 * server-side. Nothing returned from this client is safe for a browser
 * payload: callers must map to the safe projections before responding.
 */
@Injectable()
export class MetaGraphClient {
  private readonly logger = new Logger(MetaGraphClient.name);
  private readonly appId: string;
  private readonly appSecret: string;
  private readonly redirectUri: string;
  private readonly graphBaseUrl: string;
  private readonly graphVersion: string;
  private readonly timeoutMs: number;

  constructor(
    private readonly http: HttpService,
    private readonly configService: ConfigService,
    private readonly facebookService: FacebookService,
  ) {
    this.appId = this.configService.get<string>("meta.appId", "");
    this.appSecret = this.configService.get<string>("meta.appSecret", "");
    this.redirectUri = this.configService.get<string>("meta.redirectUri", "");
    this.graphBaseUrl = this.configService.get<string>(
      "meta.graphBaseUrl",
      "https://graph.facebook.com",
    );
    this.graphVersion = this.configService.get<string>(
      "meta.graphVersion",
      "v21.0",
    );
    this.timeoutMs =
      parseInt(
        this.configService.get<string>("meta.requestTimeoutMs", "15000"),
        10,
      ) || 15000;
  }

  /** True when the static Meta app configuration is present (deployment secret
   *  gate — connect fails closed when absent). */
  isConfigured(): boolean {
    return Boolean(this.appId && this.appSecret && this.redirectUri);
  }

  /** Meta authorization URL carrying the single-use state + redirect URI.
   *  Only the state/redirect/scope travel to Meta — never a token. */
  buildAuthorizationUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.appId,
      redirect_uri: this.redirectUri,
      state,
      response_type: "code",
      scope: META_LEAST_PRIVILEGE_SCOPES.join(","),
    });
    return `${this.graphBaseUrl}/${this.graphVersion}/dialog/oauth?${params.toString()}`;
  }

  /**
   * Exchanges the authorization code for a LONG-LIVED user token
   * (server-to-server, two steps): code → short-lived user token →
   * `fb_exchange_token` → long-lived user token (~60 days).
   */
  async exchangeCodeForLongLivedUserToken(
    code: string,
  ): Promise<MetaLongLivedUserToken> {
    this.assertConfigured();
    const short = await this.graphGet<{
      access_token: string;
      token_type?: string;
      expires_in?: number;
    }>("/oauth/access_token", {
      client_id: this.appId,
      client_secret: this.appSecret,
      redirect_uri: this.redirectUri,
      code,
    });
    if (!short.access_token) {
      throw new MetaGraphClientError({
        status: 400,
        code: 0,
        message: "token exchange returned no access_token",
      });
    }
    const long = await this.graphGet<{
      access_token: string;
      token_type?: string;
      expires_in?: number;
    }>("/oauth/access_token", {
      grant_type: "fb_exchange_token",
      client_id: this.appId,
      client_secret: this.appSecret,
      fb_exchange_token: short.access_token,
    });
    const accessToken = long.access_token || short.access_token;
    const expiresIn = long.expires_in ?? short.expires_in ?? 60 * 60 * 24 * 60;
    const me = await this.graphGet<{ id?: string; name?: string }>("/me", {
      fields: "id,name",
      access_token: accessToken,
    }).catch(() => ({ id: null, name: null }));
    return {
      accessToken,
      expiresAt: new Date(Date.now() + expiresIn * 1000),
      userId: me.id ?? null,
      userName: me.name ?? null,
    };
  }

  /** Granted-permission snapshot for the authorizing user token (live check of
   *  the least-privilege matrix before capability claims). */
  async fetchGrantedPermissions(
    userToken: string,
  ): Promise<readonly MetaGrantedPermission[]> {
    const data = await this.graphGet<{
      data?: Array<{ permission: string; status: string }>;
    }>("/me/permissions", { access_token: userToken });
    return (data.data ?? []).map((p) => ({
      permission: p.permission,
      status: p.status,
    }));
  }

  /**
   * Reads the frozen Facebook post Insights allowlist server-side. The
   * provider object id and Page token are both supplied by the vault-backed
   * service boundary; this method never accepts browser input.
   */
  async fetchFacebookPostInsights(params: {
    pageToken: string;
    postId: string;
    metrics?: readonly string[];
  }): Promise<MetaFacebookPostInsights> {
    const postId = String(params.postId).trim();
    if (!postId) {
      throw new MetaGraphClientError({
        status: 400,
        code: 0,
        message: "facebook insights request requires a post id",
      });
    }
    const metrics = params.metrics?.length
      ? [...params.metrics]
      : [...META_FACEBOOK_INSIGHTS_METRICS];
    const unsupportedMetrics = metrics.filter(
      (metric) =>
        !(META_FACEBOOK_INSIGHTS_METRICS as readonly string[]).includes(metric),
    );
    if (unsupportedMetrics.length > 0) {
      throw new MetaGraphClientError({
        status: 400,
        code: 0,
        message: "facebook insights metric is not in the allowlist",
      });
    }
    const requestedMetrics = new Set<string>(metrics);
    const data = await this.graphGet<{
      data?: Array<{
        name?: string;
        period?: string;
        values?: Array<{
          value?: unknown;
          end_time?: string;
        }>;
      }>;
    }>(`/${encodeURIComponent(postId)}/insights`, {
      metric: metrics.join(","),
      access_token: params.pageToken,
    });

    return {
      postId,
      metrics: (data.data ?? [])
        .filter((metric) => requestedMetrics.has(String(metric.name ?? "")))
        .map((metric) => ({
          name: String(metric.name ?? ""),
          period: metric.period ?? null,
          values: (metric.values ?? []).flatMap((point) => {
            const value = normalizeInsightValue(point.value);
            return value === null
              ? []
              : [{ value, endTime: point.end_time ?? null }];
          }),
        })),
    };
  }

  /** Pages the owner can manage, with any linked Instagram Professional
   *  account. `access_token` is present per page only when the owner actually
   *  holds page-manage privilege. */
  async listManageablePages(userToken: string): Promise<MetaPageAccount[]> {
    const data = await this.graphGet<{
      data?: Array<{
        id?: string;
        name?: string;
        access_token?: string;
        instagram_business_account?: {
          id?: string;
          username?: string;
          name?: string;
        };
      }>;
    }>("/me/accounts", {
      fields:
        "id,name,access_token,instagram_business_account{id,username,name,profile_picture_url}",
      limit: "500",
      access_token: userToken,
    });
    return (data.data ?? []).map((page) => ({
      pageId: String(page.id ?? ""),
      name: page.name ?? "",
      accessToken: page.access_token ?? null,
      instagramBusinessAccount: page.instagram_business_account
        ? {
            id: String(page.instagram_business_account.id ?? ""),
            username: page.instagram_business_account.username ?? "",
            name: page.instagram_business_account.name ?? "",
          }
        : null,
    }));
  }

  /** Live page-access verification (token validity + page reachability). */
  async verifyPageAccess(
    pageToken: string,
    pageId: string,
  ): Promise<{ name: string }> {
    const data = await this.graphGet<{ id?: string; name?: string }>(
      `/${pageId}`,
      { fields: "id,name", access_token: pageToken },
    );
    return { name: data.name ?? String(pageId) };
  }

  /** Live Instagram Business Account verification through the Page token. */
  async verifyInstagramAccess(
    pageToken: string,
    igBusinessId: string,
  ): Promise<{ username: string }> {
    const data = await this.graphGet<{ id?: string; username?: string }>(
      `/${igBusinessId}`,
      { fields: "id,username", access_token: pageToken },
    );
    return { username: data.username ?? String(igBusinessId) };
  }

  /** Facebook Page static-image publish. Delegates the Graph API transport to
   *  FacebookService, which owns the canonical Page publish logic. */
  async publishFacebookPhoto(params: {
    pageToken: string;
    pageId: string;
    imageUrl: string;
    caption: string;
  }): Promise<MetaPublishResult> {
    try {
      return await this.facebookService.publishPhotoViaPageToken(params);
    } catch (err) {
      throw this.normalizeError(err);
    }
  }

  /** Facebook Page text-only publish for approved text_post candidates. */
  async publishFacebookText(params: {
    pageToken: string;
    pageId: string;
    caption: string;
  }): Promise<MetaPublishResult> {
    const response = await this.graphPost<{ id?: string }>(
      `/${params.pageId}/feed`,
      {
        message: params.caption,
        access_token: params.pageToken,
      },
    );
    const remotePublicationId = String(response.id ?? "");
    if (!remotePublicationId) {
      throw new MetaGraphClientError({
        status: 200,
        code: 0,
        message: "page feed response carried no post id",
      });
    }
    return { remotePublicationId, remoteUrl: null };
  }

  /**
   * Instagram Professional static-image publish: create media container
   * (image_url = short-lived provider-fetch URL), poll until FINISHED, then
   * publish the container. Never publishes a container that is still
   * processing or errored.
   */
  async publishInstagramPhoto(params: {
    pageToken: string;
    igBusinessId: string;
    imageUrl: string;
    caption: string;
  }): Promise<MetaPublishResult> {
    const container = await this.graphPost<{ id?: string }>(
      `/${params.igBusinessId}/media`,
      {
        image_url: params.imageUrl,
        caption: params.caption,
        access_token: params.pageToken,
      },
    );
    const containerId = String(container.id ?? "");
    if (!containerId) {
      throw new MetaGraphClientError({
        status: 200,
        code: 0,
        message: "media container response carried no id",
      });
    }
    const containerStatus = await this.pollMediaContainer(
      containerId,
      params.pageToken,
    );
    if (containerStatus.status_code !== "FINISHED") {
      throw new MetaGraphClientError({
        status: 200,
        code: containerStatus.status_code === "ERROR" ? 0 : 1,
        message: `media container not finished (${containerStatus.status_code})`,
      });
    }
    const published = await this.graphPost<{ id?: string }>(
      `/${params.igBusinessId}/media_publish`,
      {
        creation_id: containerId,
        access_token: params.pageToken,
      },
    );
    const remotePublicationId = String(published.id || "");
    if (!remotePublicationId) {
      throw new MetaGraphClientError({
        status: 200,
        code: 0,
        message: "media_publish response carried no id",
      });
    }
    return { remotePublicationId, remoteUrl: null };
  }

  /** Bounded poll (2s interval, ~20s total) for the IG container status.
   *  Interval/count are configurable so tests can bound the wait. */
  private async pollMediaContainer(
    containerId: string,
    pageToken: string,
  ): Promise<{ status_code: string }> {
    const intervalMs =
      parseInt(this.config("meta.igPollIntervalMs", "2000"), 10) || 2000;
    const attempts =
      parseInt(this.config("meta.igPollAttempts", "10"), 10) || 10;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const data = await this.graphGet<{
        status_code?: string;
        status?: string;
      }>(`/${containerId}`, {
        fields: "status_code,status",
        access_token: pageToken,
      });
      const statusCode = data.status_code ?? data.status ?? "IN_PROGRESS";
      if (statusCode !== "IN_PROGRESS") {
        return { status_code: statusCode };
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    throw new MetaGraphClientError({
      status: 200,
      code: 1,
      message: "media container still processing after bounded poll",
    });
  }

  private config(key: string, fallback: string): string {
    return this.configService.get<string>(key, fallback) ?? fallback;
  }

  private async graphGet<T>(
    path: string,
    params: Record<string, string>,
  ): Promise<T> {
    try {
      const response = await firstValueFrom(
        this.http.get<T>(`${this.graphBaseUrl}/${this.graphVersion}${path}`, {
          params,
          timeout: this.timeoutMs,
        }),
      );
      return response.data;
    } catch (err) {
      throw this.normalizeError(err);
    }
  }

  private async graphPost<T>(
    path: string,
    params: Record<string, string>,
  ): Promise<T> {
    try {
      const response = await firstValueFrom(
        this.http.post<T>(
          `${this.graphBaseUrl}/${this.graphVersion}${path}`,
          null,
          {
            params,
            timeout: this.timeoutMs,
          },
        ),
      );
      return response.data;
    } catch (err) {
      throw this.normalizeError(err);
    }
  }

  /** Normalizes an axios/Graph failure into a sanitized MetaGraphClientError.
   *  Only status + numeric code + safe message survive; raw response bodies
   *  (which can echo tokens) are never logged or returned. */
  private normalizeError(err: unknown): MetaGraphClientError {
    const axiosError = err as AxiosError<{
      error?: { code?: number; error_subcode?: number; message?: string };
    }>;
    const responseData = axiosError?.response?.data;
    const status = axiosError?.response?.status ?? 0;
    const code = Number(responseData?.error?.code ?? 0);
    const errorSubcode = responseData?.error?.error_subcode
      ? Number(responseData.error.error_subcode)
      : undefined;
    const message = String(
      responseData?.error?.message ?? "meta graph request failed",
    )
      .replace(/\s+/g, " ")
      .slice(0, 500);
    const info: MetaGraphErrorInfo = {
      status,
      code,
      ...(errorSubcode !== undefined ? { errorSubcode } : {}),
      message,
    };
    this.logger.warn(
      `Meta Graph call failed: status=${status} code=${code}${
        errorSubcode !== undefined ? ` subcode=${errorSubcode}` : ""
      }`,
    );
    return new MetaGraphClientError(info);
  }

  private assertConfigured(): void {
    if (!this.isConfigured()) {
      throw new MetaGraphClientError({
        status: 0,
        code: 0,
        message: "PUBLISHING_META_NOT_CONFIGURED: Meta app configuration missing",
      });
    }
  }
}

function normalizeInsightValue(
  value: unknown,
): MetaFacebookInsightValue | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entries = Object.entries(value).filter(
    ([, entry]) => typeof entry === "number" && Number.isFinite(entry),
  );
  if (entries.length === 0) return null;
  return Object.fromEntries(entries) as Record<string, number>;
}
