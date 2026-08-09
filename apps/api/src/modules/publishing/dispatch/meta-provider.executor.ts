import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../../common/persistence/prisma.service";
import { CredentialVaultService } from "../credentials/credential-vault.service";
import {
  MetaGraphClient,
  MetaGraphClientError,
} from "../meta/meta-graph.client";
import { mapMetaGraphError } from "../meta/meta-error.mapper";
import { MediaFetchTokenService } from "./media-fetch-token.service";
import { PublishingErrorCode } from "../common/errors/publishing-error-codes";
import { ContentAssetReader } from "../assets/content-asset.reader";
import type { PublishingAssetReference } from "../assets/publishing-asset.types";
import * as crypto from "crypto";

export interface MetaExecutorResult {
  /** Frozen `publication-result-v1` (mode real) — sanitized by construction. */
  readonly result: {
    readonly contract_version: "publication-result-v1";
    readonly result_id: string;
    readonly attempt_id: string;
    readonly intent_id: string;
    readonly intent_version: number;
    readonly occurred_at: string;
    readonly mode: "real";
    readonly outcome: "published" | "failed" | "unknown";
    readonly provider: "meta";
    readonly remote_publication_id: string | null;
    readonly remote_url: string | null;
    readonly export_artifact_id: null;
    readonly simulation_reference_id: null;
    readonly simulation_label: null;
    readonly error_code: string | null;
    readonly retryable: boolean;
    readonly reconciliation_required: boolean;
  };
}

interface PageTokenBundle {
  readonly type: "page";
  readonly token: string;
  readonly pageId: string;
}

interface InstagramTokenBundle {
  readonly type: "instagram";
  readonly token: string;
  readonly igBusinessId: string;
}

/**
 * API-owned Meta provider executor (issue #175).
 *
 * Replaces the n8n code node's `META_TEST_PAGE_ACCESS_TOKEN` lookup for REAL
 * runs. The runner may receive only the immutable publication request and
 * opaque attempt/intent/target identifiers; this executor resolves the exact
 * target's vault credential SERVER-SIDE and returns a sanitized normalized
 * result. There is NO fallback to a shared `.env` Page token: a missing,
 * revoked, or unreadable vault record is a truthful failure.
 *
 * Asset handling: the executor never moves raw bytes through the runner. It
 * builds a short-lived, attempt+asset-bound provider-fetch URL that Meta
 * itself fetches (Facebook `url=` param, Instagram `image_url` param). The
 * dispatch-time integrity validator already proved the stored bytes match the
 * approved SHA-256 before the attempt was accepted.
 */
@Injectable()
export class MetaProviderExecutor {
  private readonly logger = new Logger(MetaProviderExecutor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly vault: CredentialVaultService,
    private readonly graph: MetaGraphClient,
    private readonly mediaFetch: MediaFetchTokenService,
    private readonly assetReader: ContentAssetReader,
  ) {}

  /** Executes the exact attempt's publish and returns a sanitized result. */
  async execute(input: {
    attemptId: string;
    intentId: string;
    targetId: string;
  }): Promise<MetaExecutorResult> {
    const base = {
      contract_version: "publication-result-v1" as const,
      result_id: crypto.randomUUID(),
      attempt_id: input.attemptId,
      intent_id: input.intentId,
      intent_version: 0,
      occurred_at: new Date().toISOString(),
      mode: "real" as const,
      outcome: "failed" as const,
      provider: "meta" as const,
      remote_publication_id: null,
      remote_url: null,
      export_artifact_id: null,
      simulation_reference_id: null,
      simulation_label: null,
      error_code: null,
      retryable: false,
      reconciliation_required: false,
    };

    // ── Resolve attempt → intent → target binding (internal misuse fails) ──
    const attempt = await this.prisma.publishingAttempt.findUnique({
      where: { id: input.attemptId },
      include: { intent: true },
    });
    if (!attempt || attempt.intentId !== input.intentId) {
      return this.failed(base, PublishingErrorCode.TARGET_UNAUTHORIZED, false);
    }
    const intent = attempt.intent;
    base.intent_version = intent.version;
    if (intent.targetId !== input.targetId) {
      return this.failed(base, PublishingErrorCode.TARGET_UNAUTHORIZED, false);
    }
    const target = await this.prisma.publishingTarget.findUnique({
      where: { id: input.targetId },
    });
    if (!target || target.connectionState !== "CONNECTED") {
      return this.failed(base, PublishingErrorCode.TARGET_UNAUTHORIZED, false);
    }
    if (target.expiresAt && target.expiresAt < new Date()) {
      return this.failed(base, PublishingErrorCode.TARGET_UNAUTHORIZED, false);
    }
    const capabilities = Array.isArray(target.capabilities)
      ? (target.capabilities as string[])
      : [];
    if (!capabilities.includes("static_image")) {
      return this.failed(base, PublishingErrorCode.FORMAT_UNSUPPORTED, false);
    }

    // ── Resolve the EXACT target's credential from the vault (never env) ──
    let tokenBundle: PageTokenBundle | InstagramTokenBundle;
    try {
      const record = await this.prisma.publishingCredential.findUnique({
        where: { id: target.credentialRef },
      });
      if (!record || record.revokedAt) {
        throw new Error("credential record missing or revoked");
      }
      const parsed = JSON.parse(this.vault.decrypt(record)) as
        | PageTokenBundle
        | InstagramTokenBundle;
      const expectedType =
        target.channel === "instagram" ? "instagram" : "page";
      if (parsed.type !== expectedType || !parsed.token) {
        throw new Error("credential bundle mismatch for channel");
      }
      tokenBundle = parsed;
    } catch (err) {
      this.logger.warn(
        `Executor: no vault credential for target=${input.targetId} (${(err as Error).message}) — truthful failure, no env fallback`,
      );
      return this.failed(base, PublishingErrorCode.TARGET_UNAUTHORIZED, false);
    }

    // ── Candidate asset for the provider-fetch URL ────────────────────────
    const candidate = await this.prisma.publishingCandidate.findUnique({
      where: { id: intent.candidateId },
    });
    const asset = this.firstStaticAsset(candidate?.payload);
    if (!asset) {
      return this.failed(base, PublishingErrorCode.ASSET_UNAVAILABLE, false);
    }
    let imageUrl: string;
    try {
      const verified = await this.assetReader.readApprovedAsset(asset);
      if (!verified) {
        return this.failed(base, PublishingErrorCode.ASSET_UNAVAILABLE, false);
      }
      imageUrl = this.mediaFetch.buildUrl({
        attemptId: input.attemptId,
        assetId: asset.asset_id,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      const code = message.includes(PublishingErrorCode.ASSET_TAMPERED)
        ? PublishingErrorCode.ASSET_TAMPERED
        : PublishingErrorCode.ASSET_UNAVAILABLE;
      return this.failed(base, code, false);
    }

    const caption = this.captionFor(candidate?.payload);

    // ── Provider call (server-side, bounded timeout, sanitized errors) ────
    try {
      if (target.channel === "instagram") {
        const ig = tokenBundle as InstagramTokenBundle;
        const published = await this.graph.publishInstagramPhoto({
          pageToken: ig.token,
          igBusinessId: target.externalAccountId,
          imageUrl,
          caption,
        });
        return {
          result: {
            ...base,
            outcome: "published",
            remote_publication_id: published.remotePublicationId,
            remote_url: published.remoteUrl,
          },
        };
      }
      const page = tokenBundle as PageTokenBundle;
      const published = await this.graph.publishFacebookPhoto({
        pageToken: page.token,
        pageId: target.externalAccountId,
        imageUrl,
        caption,
      });
      return {
        result: {
          ...base,
          outcome: "published",
          remote_publication_id: published.remotePublicationId,
          remote_url: published.remoteUrl,
        },
      };
    } catch (err) {
      if (err instanceof MetaGraphClientError) {
        if (err.info.status === 0) {
          // The request may have reached Meta — never blind-retry an
          // unconfirmed send; the outcome is ambiguous.
          return this.unknown(base);
        }
        const mapped = mapMetaGraphError(err);
        return this.failed(base, mapped.errorCode, mapped.retryable);
      }
      this.logger.warn(
        `Executor: unexpected publish error for attempt=${input.attemptId}: ${(err as Error).message}`,
      );
      return this.failed(base, PublishingErrorCode.PROVIDER_FAILURE, true);
    }
  }

  private failed(
    base: MetaExecutorResult["result"],
    errorCode: string,
    retryable: boolean,
  ): MetaExecutorResult {
    return {
      result: {
        ...base,
        outcome: "failed",
        error_code: errorCode,
        retryable,
      },
    };
  }

  private unknown(base: MetaExecutorResult["result"]): MetaExecutorResult {
    return {
      result: {
        ...base,
        outcome: "unknown",
        error_code: PublishingErrorCode.PROVIDER_OUTCOME_UNKNOWN,
        reconciliation_required: true,
      },
    };
  }

  private firstStaticAsset(payload: unknown): PublishingAssetReference | null {
    const candidate = payload as {
      assets?: Array<{
        asset_id?: string;
        mime_type?: string;
        storage_key?: string;
        checksum?: string;
      }>;
    };
    const asset = candidate?.assets?.find(
      (entry) =>
        typeof entry.asset_id === "string" &&
        entry.asset_id.length > 0 &&
        typeof entry.mime_type === "string" &&
        entry.mime_type.startsWith("image/"),
    );
    if (
      !asset?.asset_id ||
      !asset.mime_type ||
      !asset.storage_key ||
      !asset.checksum
    ) {
      return null;
    }
    return {
      asset_id: asset.asset_id,
      mime_type: asset.mime_type,
      storage_key: asset.storage_key,
      checksum: asset.checksum,
    };
  }

  private captionFor(payload: unknown): string {
    const candidate = payload as {
      caption?: string;
      hashtags?: string[];
    };
    const hashtags = Array.isArray(candidate?.hashtags)
      ? candidate.hashtags.join(" ")
      : "";
    return [candidate?.caption, hashtags].filter(Boolean).join("\n");
  }
}
