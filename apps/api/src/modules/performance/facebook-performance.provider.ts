import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../../common/persistence/prisma.service";
import {
  FacebookGraphError,
  FacebookService,
} from "../facebook/facebook.service";
import {
  CredentialVaultService,
  VaultDecryptionError,
  VaultNotConfiguredError,
} from "../publishing/credentials/credential-vault.service";
import {
  META_FACEBOOK_INSIGHTS_METRICS,
  MetaGraphClient,
  MetaGraphClientError,
  type MetaFacebookPostInsights,
} from "../publishing/meta/meta-graph.client";
import type { PerformancePublicationContext } from "../publishing/performance/performance.repository";
import { PerformanceRepositoryError } from "../publishing/performance/performance.repository";
import { facebookSocialConnectionRef } from "../publishing/targets/facebook-target-ref";
import type { PerformanceErrorCode } from "@marketmind/contracts";

export class PerformanceProviderError extends Error {
  constructor(
    readonly code: PerformanceErrorCode,
    readonly retryable: boolean,
    message: string = code,
  ) {
    super(message);
    this.name = "PerformanceProviderError";
  }
}

export type FacebookPerformanceObservation = MetaFacebookPostInsights & {
  readonly graphVersion: string;
  readonly fetchedAt: Date;
};

/**
 * Server-only Facebook Insights adapter. It accepts an immutable publishing
 * context, resolves the credential source from PostgreSQL, and returns only a
 * normalized provider projection. No raw token, headers, or Graph body can
 * cross this boundary.
 */
@Injectable()
export class FacebookPerformanceProvider {
  private readonly logger = new Logger(FacebookPerformanceProvider.name);
  private readonly graphVersion: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly graph: MetaGraphClient,
    private readonly vault: CredentialVaultService,
    private readonly facebook: FacebookService,
    private readonly config: ConfigService,
  ) {
    this.graphVersion =
      this.config.get<string>("meta.graphVersion", "v21.0") ?? "v21.0";
  }

  async fetch(
    context: PerformancePublicationContext,
  ): Promise<FacebookPerformanceObservation> {
    if (!context.target) {
      throw new PerformanceProviderError(
        "PERFORMANCE_PERMISSION_REQUIRED",
        false,
        "facebook performance credential is not connected",
      );
    }
    if (context.target.connectionState !== "CONNECTED") {
      throw new PerformanceProviderError(
        "PERFORMANCE_PERMISSION_REQUIRED",
        false,
        "facebook performance target is not connected",
      );
    }
    if (
      context.target.expiresAt &&
      context.target.expiresAt.getTime() <= Date.now()
    ) {
      throw new PerformanceProviderError(
        "PERFORMANCE_PERMISSION_REQUIRED",
        false,
        "facebook performance target credential is expired",
      );
    }

    try {
      const insights = await this.fetchWithCredential(context);
      return {
        ...insights,
        graphVersion: this.graphVersion,
        fetchedAt: new Date(),
      };
    } catch (error) {
      const normalized = this.normalizeError(error);
      this.logger.warn(
        `Facebook performance provider failed result=${context.publishingResultId} code=${normalized.code}`,
      );
      throw normalized;
    }
  }

  private async fetchWithCredential(
    context: PerformancePublicationContext,
  ): Promise<MetaFacebookPostInsights> {
    const target = context.target;
    if (!target) {
      throw new PerformanceProviderError(
        "PERFORMANCE_PERMISSION_REQUIRED",
        false,
      );
    }

    if (target.credentialRef.startsWith("facebook-social-connection:")) {
      const expectedRef = facebookSocialConnectionRef(
        await this.socialConnectionIdForTarget(target.credentialRef),
      );
      if (expectedRef !== target.credentialRef) {
        throw new PerformanceProviderError(
          "PERFORMANCE_PERMISSION_REQUIRED",
          false,
        );
      }
      return this.facebook.withPageTokenForUser(
        {
          userId: context.ownerUserId,
          pageId: target.externalAccountId,
        },
        (pageToken) =>
          this.graph.fetchFacebookPostInsights({
            pageToken,
            postId: context.providerObjectId,
            metrics: META_FACEBOOK_INSIGHTS_METRICS,
          }),
      );
    }

    const credential = await this.prisma.publishingCredential.findFirst({
      where: {
        id: target.credentialRef,
        businessId: context.businessId,
        provider: "META",
        kind: "page",
        revokedAt: null,
      },
      select: {
        ciphertext: true,
        keyVersion: true,
        providerAccountId: true,
        expiresAt: true,
      },
    });
    if (
      !credential ||
      credential.providerAccountId !== target.externalAccountId
    ) {
      throw new PerformanceProviderError(
        "PERFORMANCE_PERMISSION_REQUIRED",
        false,
        "facebook page credential is unavailable",
      );
    }
    if (credential.expiresAt && credential.expiresAt.getTime() <= Date.now()) {
      throw new PerformanceProviderError(
        "PERFORMANCE_PERMISSION_REQUIRED",
        false,
        "facebook page credential is expired",
      );
    }
    const pageToken = this.vault.decrypt(credential);
    return this.graph.fetchFacebookPostInsights({
      pageToken,
      postId: context.providerObjectId,
      metrics: META_FACEBOOK_INSIGHTS_METRICS,
    });
  }

  private async socialConnectionIdForTarget(
    reference: string,
  ): Promise<string> {
    const id = reference.slice("facebook-social-connection:".length);
    if (!id) {
      throw new PerformanceProviderError(
        "PERFORMANCE_PERMISSION_REQUIRED",
        false,
      );
    }
    const connection = await this.prisma.socialConnection.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!connection) {
      throw new PerformanceProviderError(
        "PERFORMANCE_PERMISSION_REQUIRED",
        false,
      );
    }
    return connection.id;
  }

  private normalizeError(error: unknown): PerformanceProviderError {
    if (error instanceof PerformanceProviderError) return error;
    if (error instanceof PerformanceRepositoryError) {
      return new PerformanceProviderError(error.code, false);
    }
    if (
      error instanceof VaultDecryptionError ||
      error instanceof VaultNotConfiguredError
    ) {
      return new PerformanceProviderError(
        "PERFORMANCE_PERMISSION_REQUIRED",
        false,
      );
    }
    if (error instanceof MetaGraphClientError) {
      const { status, code } = error.info;
      if (status === 404 || code === 100) {
        return new PerformanceProviderError(
          "PERFORMANCE_PROVIDER_UNAVAILABLE",
          false,
        );
      }
      if (
        status === 401 ||
        status === 403 ||
        code === 10 ||
        code === 190 ||
        code === 200
      ) {
        return new PerformanceProviderError(
          "PERFORMANCE_PERMISSION_REQUIRED",
          false,
        );
      }
      if (status === 429 || code === 4 || code === 17) {
        return new PerformanceProviderError(
          "PERFORMANCE_PROVIDER_RATE_LIMITED",
          true,
        );
      }
      if (status === 0 || status >= 500) {
        return new PerformanceProviderError(
          "PERFORMANCE_PROVIDER_UNAVAILABLE",
          true,
        );
      }
      return new PerformanceProviderError(
        "PERFORMANCE_PROVIDER_UNAVAILABLE",
        false,
      );
    }
    if (error instanceof FacebookGraphError) {
      if (error.status === 404 || error.code === 100) {
        return new PerformanceProviderError(
          "PERFORMANCE_PROVIDER_UNAVAILABLE",
          false,
        );
      }
      if (error.status === 401 || error.status === 403 || error.code === 190) {
        return new PerformanceProviderError(
          "PERFORMANCE_PERMISSION_REQUIRED",
          false,
        );
      }
      if (error.status === 429 || error.code === 4 || error.code === 17) {
        return new PerformanceProviderError(
          "PERFORMANCE_PROVIDER_RATE_LIMITED",
          true,
        );
      }
      if (error.status === 0 || error.status >= 500) {
        return new PerformanceProviderError(
          "PERFORMANCE_PROVIDER_UNAVAILABLE",
          true,
        );
      }
    }
    return new PerformanceProviderError(
      "PERFORMANCE_PROVIDER_UNAVAILABLE",
      true,
    );
  }
}
