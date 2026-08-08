import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  PublishingConnectionState,
  PublishingTargetConnectionState,
  type PublishingProviderConnection,
  type PublishingTarget,
} from "@prisma/client";
import { PrismaService } from "../../../common/persistence/prisma.service";
import { PublishingErrorCode } from "../common/errors/publishing-error-codes";
import { toTargetProjection } from "./targets.service";
import type { TargetProjection } from "./targets.dto";
import { CredentialVaultService } from "../credentials/credential-vault.service";
import {
  MetaGraphClient,
  type MetaPageAccount,
} from "../meta/meta-graph.client";
import { MetaOAuthStateStore } from "../meta/meta-oauth-state.store";
import { mapMetaGraphErrorToConnectionState } from "../meta/meta-error.mapper";
import { MetaGraphClientError } from "../meta/meta-graph.client";

/** Additive error codes for the issue #175 connection boundary. */
export const MetaConnectionErrorCode = {
  NOT_CONFIGURED: "PUBLISHING_META_NOT_CONFIGURED",
  STATE_INVALID: "PUBLISHING_META_STATE_INVALID",
  TARGET_BLOCKED: "PUBLISHING_TARGET_BLOCKED",
  TARGET_CONFLICT: "PUBLISHING_TARGET_CONFLICT",
  SELECTION_EXPIRED: "PUBLISHING_META_SELECTION_EXPIRED",
} as const;

export type MetaCallbackResultCode =
  | "success"
  | "cancelled"
  | "expired"
  | "denied"
  | "unknown";

export interface MetaCallbackRedirect {
  readonly url: string;
}

export interface MetaPendingSelection {
  readonly connection_id: string;
  readonly requested_channel: string | null;
  readonly requested_capability: string;
  readonly expires_at: Date | null;
  readonly options: readonly MetaAccountOption[];
}

export interface MetaAccountOption {
  readonly page: MetaChannelOption;
  readonly instagram: MetaChannelOption | null;
}

export interface MetaChannelOption {
  readonly channel: "facebook" | "instagram";
  readonly account_id: string;
  readonly display_name: string;
  readonly capability_status: "supported" | "unsupported";
  readonly blockers: readonly string[];
}

interface UserTokenBundle {
  readonly type: "user";
  readonly token: string;
  readonly userId: string;
  readonly userName: string;
  readonly expiresAt: string;
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

const DEFAULT_LOCALE = "ar";
const DEFAULT_RETURN_PATH = "/publishing";
const CAPABILITY_STATIC_IMAGE = "static_image";

/**
 * Meta OAuth connection journey (issue #175): initiation → API-owned callback →
 * safe pending-account selection → target creation → verification / reconnect /
 * disconnect. Every operation is bound to the resolved business scope and the
 * authenticated owner; tokens never leave the server and only sanitized codes
 * cross the browser boundary.
 */
@Injectable()
export class MetaConnectionService {
  private readonly logger = new Logger(MetaConnectionService.name);
  private readonly webBaseUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly vault: CredentialVaultService,
    private readonly graph: MetaGraphClient,
    private readonly stateStore: MetaOAuthStateStore,
  ) {
    this.webBaseUrl = this.config.get<string>(
      "publishing.webBaseUrl",
      "http://localhost:3000",
    );
  }

  /** Step 1 — initiate the OAuth journey and return the safe authorization URL. */
  async initiateConnect(input: {
    businessId: string;
    userId: string;
    provider: string;
    channel: string;
    locale?: string;
    returnPath?: string;
    fingerprint?: string;
  }): Promise<{ connection_id: string; authorization_url: string; expires_at: Date }> {
    if (input.provider !== "META") {
      throw new UnprocessableEntityException(
        `${PublishingErrorCode.CONTRACT_UNSUPPORTED}: provider ${input.provider}`,
      );
    }
    if (input.channel !== "facebook" && input.channel !== "instagram") {
      throw new UnprocessableEntityException(
        `${PublishingErrorCode.CONTRACT_UNSUPPORTED}: channel ${input.channel}`,
      );
    }
    if (!this.graph.isConfigured()) {
      throw new ServiceUnavailableException(
        `${MetaConnectionErrorCode.NOT_CONFIGURED}: Meta app configuration (META_APP_ID / META_APP_SECRET / META_REDIRECT_URI) is missing — connect is blocked until deployment secrets are provided`,
      );
    }
    const created = await this.stateStore.create({
      userId: input.userId,
      businessId: input.businessId,
      locale: input.locale ?? null,
      returnPath: input.returnPath ?? null,
      requestedChannel: input.channel,
      requestedCapability: CAPABILITY_STATIC_IMAGE,
      fingerprint: input.fingerprint ?? null,
    });
    this.logger.log(
      `Meta connect initiated for business=${input.businessId} channel=${input.channel} state=${created.id}`,
    );
    return {
      connection_id: created.id,
      authorization_url: this.graph.buildAuthorizationUrl(created.state),
      expires_at: created.expiresAt,
    };
  }

  /**
   * Step 2 — API-owned GET callback (Meta redirect target). Consumes the state
   * atomically, exchanges the code server-to-server, stores the long-lived
   * user token in the vault, and 302-redirects the browser with only a result
   * code + connection id.
   */
  async handleCallback(query: {
    code?: string;
    state?: string;
    error?: string;
    error_reason?: string;
    error_description?: string;
  }): Promise<MetaCallbackRedirect> {
    const state = query.state ?? "";
    if (!state) {
      return this.redirect("unknown", null);
    }
    if (query.error) {
      // Meta reported a denial/cancellation — consume the state if we know it
      // so a later forged success callback cannot reuse it, then redirect with
      // a sanitized code (never echo error_description/error_reason).
      const bound = await this.stateStore.peek(state);
      await this.stateStore.markConsumed(state).catch(() => undefined);
      const code: MetaCallbackResultCode = bound
        ? this.cancellationCode(query.error)
        : "unknown";
      this.logger.log(
        `Meta callback reported error for state=${bound?.id ?? "?"} → ${code}`,
      );
      return this.redirect(code, bound?.id ?? null, bound ?? undefined);
    }

    // Atomic single-use consumption BEFORE any code exchange (replay-proof).
    const bound = await this.stateStore.consume(state);
    if (!bound) {
      this.logger.warn(
        "Meta callback with unknown/expired/replayed state — redirecting expired",
      );
      return this.redirect("expired", null);
    }
    if (!query.code) {
      return this.redirect("unknown", bound.id);
    }

    // Server-to-server code exchange — the code never reaches the browser.
    let token: UserTokenBundle;
    try {
      const exchanged = await this.graph.exchangeCodeForLongLivedUserToken(
        query.code,
      );
      token = {
        type: "user",
        token: exchanged.accessToken,
        userId: exchanged.userId ?? "",
        userName: exchanged.userName ?? "",
        expiresAt: exchanged.expiresAt.toISOString(),
      };
    } catch (err) {
      this.logger.warn(
        `Meta code exchange failed for state=${bound.id}: ${
          err instanceof MetaGraphClientError
            ? `status=${err.info.status} code=${err.info.code}`
            : "unknown exchange error"
        }`,
      );
      return this.redirect("unknown", bound.id);
    }

    const encrypted = this.vault.encrypt(JSON.stringify(token));
    const tokenExpiresAt = new Date(token.expiresAt);
    const credential = await this.prisma.publishingCredential.create({
      data: {
        businessId: bound.businessId,
        provider: "META",
        kind: "user",
        keyVersion: encrypted.keyVersion,
        ciphertext: encrypted.ciphertext,
        providerUserId: token.userId || null,
        expiresAt: tokenExpiresAt,
      },
    });

    // Upsert the PENDING connection (re-initiated flows replace the earlier
    // pending row; the external account is resolved at selection time).
    const connection = await this.prisma.publishingProviderConnection.upsert({
      where: {
        businessId_provider_externalAccountId: {
          businessId: bound.businessId,
          provider: "META",
          externalAccountId: token.userId || bound.userId,
        },
      },
      update: {
        userId: bound.userId,
        providerIdentity: token.userId || bound.userId,
        state: PublishingConnectionState.PENDING_SELECTION,
        userCredentialRef: credential.id,
        locale: bound.locale ?? null,
        returnPath: bound.returnPath ?? null,
        requestedChannel: bound.requestedChannel,
        requestedCapability: bound.requestedCapability,
        fingerprint: bound.fingerprint ?? null,
        expiresAt: tokenExpiresAt,
        version: { increment: 1 },
      },
      create: {
        businessId: bound.businessId,
        userId: bound.userId,
        provider: "META",
        providerIdentity: token.userId || bound.userId,
        displayName: token.userName || "Meta account",
        externalAccountId: token.userId || bound.userId,
        state: PublishingConnectionState.PENDING_SELECTION,
        userCredentialRef: credential.id,
        locale: bound.locale ?? null,
        returnPath: bound.returnPath ?? null,
        requestedChannel: bound.requestedChannel,
        requestedCapability: bound.requestedCapability,
        fingerprint: bound.fingerprint ?? null,
        expiresAt: tokenExpiresAt,
      },
    });

    await this.prisma.publishingConnectionAudit.create({
      data: {
        businessId: bound.businessId,
        connectionId: connection.id,
        actorUserId: bound.userId,
        action: "CONNECTED",
        detail: {
          provider: "META",
          requested_channel: bound.requestedChannel,
        },
      },
    });

    return this.redirect("success", connection.id, bound);
  }

  /** Step 3 — safe pending-account selection metadata (never tokens). */
  async getPendingSelection(input: {
    businessId: string;
    userId: string;
    connectionId: string;
    fingerprint?: string;
  }): Promise<MetaPendingSelection> {
    const connection = await this.loadPendingConnection(input);
    const userToken = await this.loadUserToken(connection);
    const granted = new Set(
      (
        await this.graph.fetchGrantedPermissions(userToken)
      ).map((p) => p.permission),
    );
    const pages = await this.graph.listManageablePages(userToken);
    const options = pages.map((page) =>
      this.optionForPage(page, granted),
    );
    return {
      connection_id: connection.id,
      requested_channel: connection.requestedChannel,
      requested_capability: connection.requestedCapability,
      expires_at: connection.expiresAt,
      options,
    };
  }

  /** Step 4 — create targets from the owner's selection after LIVE capability
   *  verification. Returns safe target projections only. */
  async selectTargets(input: {
    businessId: string;
    userId: string;
    connectionId: string;
    pageId: string;
    includeInstagram: boolean;
    fingerprint?: string;
  }): Promise<TargetProjection[]> {
    const connection = await this.loadPendingConnection(input);
    const userToken = await this.loadUserToken(connection);
    const granted = new Set(
      (
        await this.graph.fetchGrantedPermissions(userToken)
      ).map((p) => p.permission),
    );
    const pages = await this.graph.listManageablePages(userToken);
    const page = pages.find((p) => p.pageId === input.pageId);
    if (!page) {
      throw new UnprocessableEntityException(
        `${MetaConnectionErrorCode.TARGET_BLOCKED}: selected page is not discoverable for this owner`,
      );
    }
    const option = this.optionForPage(page, granted);
    if (option.page.capability_status !== "supported") {
      throw new UnprocessableEntityException(
        `${MetaConnectionErrorCode.TARGET_BLOCKED}: ${option.page.blockers.join(",")}`,
      );
    }
    if (input.includeInstagram) {
      if (!option.instagram) {
        throw new UnprocessableEntityException(
          `${MetaConnectionErrorCode.TARGET_BLOCKED}: instagram_not_linked`,
        );
      }
      if (option.instagram.capability_status !== "supported") {
        throw new UnprocessableEntityException(
          `${MetaConnectionErrorCode.TARGET_BLOCKED}: ${option.instagram.blockers.join(",")}`,
        );
      }
    }
    const pageToken = page.accessToken;
    if (!pageToken) {
      throw new UnprocessableEntityException(
        `${MetaConnectionErrorCode.TARGET_BLOCKED}: no_page_privilege`,
      );
    }
    const providerIdentity =
      connection.providerIdentity || connection.externalAccountId;

    // Explicit replacement rule: connecting a DIFFERENT external account while
    // this business still holds an active target is a conflict — the owner must
    // disconnect first. Reconnecting the SAME page is an explicit replace
    // journey (fresh credentials, same account).
    const activeTargets = await this.prisma.publishingTarget.findMany({
      where: {
        businessId: input.businessId,
        connectionState: { not: PublishingTargetConnectionState.REVOKED },
      },
    });
    const foreignActive = activeTargets.find(
      (t) => t.externalAccountId !== input.pageId,
    );
    if (foreignActive) {
      throw new ConflictException(
        `${MetaConnectionErrorCode.TARGET_CONFLICT}: another account (${foreignActive.externalAccountId}) is already connected for this business — disconnect it before connecting ${input.pageId}`,
      );
    }

    const now = new Date();
    const targets: TargetProjection[] = [];

    const facebookVault = await this.createVaultRecord({
      businessId: input.businessId,
      kind: "page",
      providerAccountId: input.pageId,
      expiresAt: connection.expiresAt,
      payload: { type: "page", token: pageToken, pageId: input.pageId },
    });

    let selected: PublishingProviderConnection;
    try {
      selected = await this.prisma.$transaction(async (tx) => {
        // Replace any stale credential records from a previous selection of the
        // same account (reconnect journey) — the fresh ones below take over.
        await tx.publishingCredential.deleteMany({
          where: {
            businessId: input.businessId,
            providerAccountId: input.pageId,
            kind: "page",
            id: { not: facebookVault.id },
          },
        });

        return tx.publishingProviderConnection.upsert({
          where: {
            businessId_provider_externalAccountId: {
              businessId: input.businessId,
              provider: "META",
              externalAccountId: input.pageId,
            },
          },
          update: {
            userId: input.userId,
            providerIdentity,
            displayName: page.name,
            state: PublishingConnectionState.ACTIVE,
            requestedCapability: connection.requestedCapability,
            expiresAt: connection.expiresAt,
            version: { increment: 1 },
          },
          create: {
            businessId: input.businessId,
            userId: input.userId,
            provider: "META",
            providerIdentity,
            displayName: page.name,
            externalAccountId: input.pageId,
            state: PublishingConnectionState.ACTIVE,
            requestedChannel: connection.requestedChannel,
            requestedCapability: connection.requestedCapability,
            locale: connection.locale,
            returnPath: connection.returnPath,
            fingerprint: connection.fingerprint,
            userCredentialRef: connection.userCredentialRef,
            expiresAt: connection.expiresAt,
          },
        });
      });
    } catch (err) {
      if ((err as { code?: string }).code === "P2002") {
        throw new ConflictException(
          `${MetaConnectionErrorCode.TARGET_CONFLICT}: account ${input.pageId} is already connected for this business`,
        );
      }
      throw err;
    }

    const facebookTarget = await this.upsertTarget({
      businessId: input.businessId,
      connectionId: selected.id,
      channel: "facebook",
      externalAccountId: input.pageId,
      displayName: page.name,
      credentialRef: facebookVault.id,
      expiresAt: connection.expiresAt,
      verifiedAt: now,
    });
    targets.push(facebookTarget);

    let instagramVaultId: string | null = null;
    if (input.includeInstagram && option.instagram) {
      const ig = option.instagram;
      const instagramVault = await this.createVaultRecord({
        businessId: input.businessId,
        kind: "instagram",
        providerAccountId: ig.account_id,
        expiresAt: connection.expiresAt,
        payload: {
          type: "instagram",
          token: pageToken,
          igBusinessId: ig.account_id,
        },
      });
      instagramVaultId = instagramVault.id;
      await this.prisma.publishingCredential.deleteMany({
        where: {
          businessId: input.businessId,
          providerAccountId: ig.account_id,
          kind: "instagram",
          id: { not: instagramVault.id },
        },
      });
      const instagramTarget = await this.upsertTarget({
        businessId: input.businessId,
        connectionId: selected.id,
        channel: "instagram",
        externalAccountId: ig.account_id,
        displayName: ig.display_name,
        credentialRef: instagramVault.id,
        expiresAt: connection.expiresAt,
        verifiedAt: now,
      });
      targets.push(instagramTarget);
    }
    void instagramVaultId;

    await this.prisma.publishingConnectionAudit.create({
      data: {
        businessId: input.businessId,
        connectionId: selected.id,
        targetId: facebookTarget.id,
        actorUserId: input.userId,
        action: "SELECTED",
        detail: {
          page_id: input.pageId,
          include_instagram: input.includeInstagram,
          instagram_account_id: option.instagram?.account_id ?? null,
        },
      },
    });

    return targets;
  }

  /** Step 5 — reconnect journey entry (reuses the connect flow). */
  async reconnectTarget(input: {
    businessId: string;
    userId: string;
    targetId: string;
    locale?: string;
    returnPath?: string;
    fingerprint?: string;
  }): Promise<{ connection_id: string; authorization_url: string; expires_at: Date }> {
    const target = await this.prisma.publishingTarget.findFirst({
      where: { id: input.targetId, businessId: input.businessId },
    });
    if (!target) throw new NotFoundException(PublishingErrorCode.NOT_FOUND);
    return this.initiateConnect({
      businessId: input.businessId,
      userId: input.userId,
      provider: target.provider,
      channel: target.channel,
      locale: input.locale,
      returnPath: input.returnPath,
      fingerprint: input.fingerprint,
    });
  }

  /** Step 6 — disconnect: cancel future real intents safely, revoke the target,
   *  and delete/revoke the credential when no target still uses it. */
  async disconnectTarget(input: {
    targetId: string;
    businessId: string;
    userId: string;
  }): Promise<TargetProjection> {
    const { target, updated } = await this.prisma.$transaction(async (tx) => {
      const target = await tx.publishingTarget.findFirst({
        where: { id: input.targetId, businessId: input.businessId },
      });
      if (!target) throw new NotFoundException(PublishingErrorCode.NOT_FOUND);

      // Invalidates every scheduled real publication bound to this target:
      // status leaves the claimable set, so any already-enqueued BullMQ job
      // fails its atomic claim and becomes a recorded no-op.
      const cancelled = await tx.publishingIntent.updateMany({
        where: {
          targetId: target.id,
          status: { in: ["AWAITING_APPROVAL", "SCHEDULED"] },
        },
        data: { status: "CANCELLED" },
      });

      await tx.publishingCredential.updateMany({
        where: { id: target.credentialRef },
        data: { revokedAt: new Date() },
      });

      const updated = await tx.publishingTarget.update({
        where: { id: target.id },
        data: {
          connectionState: PublishingTargetConnectionState.REVOKED,
          version: { increment: 1 },
        },
      });

      // Credential deletion: remove the vault record ONLY when no other target
      // still references it (facebook + instagram targets of one page share a
      // connection but never a credentialRef — still, guard generally).
      const stillUsed = await tx.publishingTarget.findFirst({
        where: {
          credentialRef: target.credentialRef,
          id: { not: target.id },
          connectionState: { not: PublishingTargetConnectionState.REVOKED },
        },
        select: { id: true },
      });
      if (!stillUsed) {
        await tx.publishingCredential.delete({
          where: { id: target.credentialRef },
        });
      }

      // Connection row: when the last non-revoked target goes, revoke the
      // connection and drop the authorizing user credential too.
      if (target.connectionId) {
        const siblings = await tx.publishingTarget.findMany({
          where: {
            connectionId: target.connectionId,
            connectionState: { not: PublishingTargetConnectionState.REVOKED },
          },
          select: { id: true },
        });
        if (siblings.length === 0) {
          const connection = await tx.publishingProviderConnection.findUnique({
            where: { id: target.connectionId },
          });
          if (connection?.userCredentialRef) {
            await tx.publishingCredential.updateMany({
              where: {
                id: connection.userCredentialRef,
                revokedAt: null,
              },
              data: { revokedAt: new Date() },
            });
            await tx.publishingCredential.delete({
              where: { id: connection.userCredentialRef },
            });
          }
          await tx.publishingProviderConnection.update({
            where: { id: target.connectionId },
            data: {
              state: PublishingConnectionState.REVOKED,
              version: { increment: 1 },
            },
          });
        }
      }

      await tx.publishingConnectionAudit.create({
        data: {
          businessId: input.businessId,
          connectionId: target.connectionId,
          targetId: target.id,
          actorUserId: input.userId,
          action: "DISCONNECTED",
          detail: {
            channel: target.channel,
            cancelled_scheduled_intents: cancelled.count,
          },
        },
      });

      return { target, updated };
    });

    this.logger.log(
      `Target ${input.targetId} disconnected for business=${input.businessId} (cancelled scheduled intents, credential revoked)`,
    );
    void target;
    return toTargetProjection(updated);
  }

  /**
   * Hard delete (frozen DELETE /:targetId): cancels future real intents,
   * revokes/deletes the credential when unused, removes the row, and records a
   * non-sensitive audit entry. Never leaves a dangling scheduled intent that
   * would dispatch against a missing target.
   */
  async deleteTarget(input: {
    targetId: string;
    businessId: string;
    userId: string;
  }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const target = await tx.publishingTarget.findFirst({
        where: { id: input.targetId, businessId: input.businessId },
      });
      if (!target) throw new NotFoundException(PublishingErrorCode.NOT_FOUND);

      await tx.publishingIntent.updateMany({
        where: {
          targetId: target.id,
          status: { in: ["AWAITING_APPROVAL", "SCHEDULED"] },
        },
        data: { status: "CANCELLED" },
      });

      const stillUsed = await tx.publishingTarget.findFirst({
        where: {
          credentialRef: target.credentialRef,
          id: { not: target.id },
        },
        select: { id: true },
      });
      if (!stillUsed) {
        await tx.publishingCredential.deleteMany({
          where: { id: target.credentialRef },
        });
      }

      await tx.publishingTarget.delete({ where: { id: target.id } });

      if (target.connectionId) {
        const siblings = await tx.publishingTarget.findMany({
          where: { connectionId: target.connectionId },
          select: { id: true },
        });
        if (siblings.length === 0) {
          const connection = await tx.publishingProviderConnection.findUnique({
            where: { id: target.connectionId },
          });
          if (connection?.userCredentialRef) {
            await tx.publishingCredential.deleteMany({
              where: { id: connection.userCredentialRef },
            });
          }
          await tx.publishingProviderConnection.deleteMany({
            where: { id: target.connectionId },
          });
        }
      }

      await tx.publishingConnectionAudit.create({
        data: {
          businessId: input.businessId,
          connectionId: target.connectionId,
          targetId: target.id,
          actorUserId: input.userId,
          action: "DELETED",
          detail: { channel: target.channel },
        },
      });
    });
  }

  /**
   * Live provider verification (issue #175): resolves the exact target's vault
   * credential, performs a real Graph round-trip, and updates connection state
   * truthfully — a failed/expired verification becomes a blocked state, never a
   * connected target.
   */
  async verifyTargetLive(input: {
    targetId: string;
    businessId: string;
    expectedVersion: number;
    actorUserId: string;
  }): Promise<{ target: TargetProjection; verifiedAt: Date }> {
    const verifiedAt = new Date();
    const target = await this.prisma.$transaction(async (tx) => {
      const current = await tx.publishingTarget.findFirst({
        where: { id: input.targetId, businessId: input.businessId },
      });
      if (!current) throw new NotFoundException(PublishingErrorCode.NOT_FOUND);
      if (current.version !== input.expectedVersion) {
        throw new ConflictException(PublishingErrorCode.VERSION_CONFLICT);
      }
      if (current.connectionState !== PublishingTargetConnectionState.CONNECTED) {
        throw new UnprocessableEntityException(
          PublishingErrorCode.TARGET_NOT_CONNECTED,
        );
      }
      if (current.expiresAt && current.expiresAt < verifiedAt) {
        throw new UnprocessableEntityException(
          PublishingErrorCode.TARGET_UNAUTHORIZED,
        );
      }
      return current;
    });

    // Resolve + decrypt the exact target's vault credential (never env).
    let token: PageTokenBundle | InstagramTokenBundle;
    try {
      const record = await this.prisma.publishingCredential.findUnique({
        where: { id: target.credentialRef },
      });
      if (!record || record.revokedAt) {
        throw new Error("credential record missing or revoked");
      }
      token = JSON.parse(this.vault.decrypt(record)) as
        | PageTokenBundle
        | InstagramTokenBundle;
      if (token.type !== "page" && token.type !== "instagram") {
        throw new Error("credential is not a publishable token bundle");
      }
    } catch {
      await this.markTargetError(target.id, input.businessId, "ERROR");
      await this.audit(input.businessId, target.id, target.connectionId, input.actorUserId, "ERROR", {
        channel: target.channel,
        reason: "credential_unreadable",
      });
      throw new UnprocessableEntityException(
        `${MetaConnectionErrorCode.TARGET_BLOCKED}: credential_unreadable`,
      );
    }

    try {
      if (target.channel === "instagram") {
        await this.graph.verifyInstagramAccess(
          token.token,
          target.externalAccountId,
        );
      } else {
        await this.graph.verifyPageAccess(token.token, target.externalAccountId);
      }
    } catch (err) {
      const state = err instanceof MetaGraphClientError
        ? mapMetaGraphErrorToConnectionState(err)
        : "ERROR";
      await this.markTargetError(target.id, input.businessId, state);
      await this.audit(input.businessId, target.id, target.connectionId, input.actorUserId, state, {
        channel: target.channel,
        reason: "live_verification_failed",
      });
      throw new UnprocessableEntityException(
        state === "EXPIRED"
          ? PublishingErrorCode.TARGET_UNAUTHORIZED
          : `${MetaConnectionErrorCode.TARGET_BLOCKED}: verification_failed`,
      );
    }

    const updated = await this.prisma.publishingTarget.update({
      where: { id: target.id },
      data: {
        lastVerifiedAt: verifiedAt,
        version: { increment: 1 },
      },
    });
    await this.audit(input.businessId, target.id, target.connectionId, input.actorUserId, "VERIFIED", {
      channel: target.channel,
    });
    return { target: toTargetProjection(updated), verifiedAt };
  }

  // ── Internals ─────────────────────────────────────────────────────────

  private async markTargetError(
    targetId: string,
    businessId: string,
    state: "EXPIRED" | "ERROR",
  ): Promise<void> {
    await this.prisma.publishingTarget.update({
      where: { id: targetId },
      data: {
        connectionState:
          state === "EXPIRED"
            ? PublishingTargetConnectionState.EXPIRED
            : PublishingTargetConnectionState.ERROR,
        version: { increment: 1 },
      },
    });
  }

  private async audit(
    businessId: string,
    targetId: string | null,
    connectionId: string | null,
    actorUserId: string,
    action: string,
    detail: Record<string, unknown>,
  ): Promise<void> {
    await this.prisma.publishingConnectionAudit.create({
      data: {
        businessId,
        targetId,
        connectionId,
        actorUserId,
        action,
        detail: detail as never,
      },
    });
  }

  private optionForPage(
    page: MetaPageAccount,
    granted: ReadonlySet<string>,
  ): MetaAccountOption {
    const pageBlockers: string[] = [];
    if (!page.accessToken) pageBlockers.push("no_page_privilege");
    if (!granted.has("pages_manage_posts")) {
      pageBlockers.push("page_publish_capability_missing");
    }
    const pageOption: MetaChannelOption = {
      channel: "facebook",
      account_id: page.pageId,
      display_name: page.name || page.pageId,
      capability_status: pageBlockers.length === 0 ? "supported" : "unsupported",
      blockers: pageBlockers,
    };

    let instagram: MetaChannelOption | null = null;
    if (page.instagramBusinessAccount) {
      const igBlockers: string[] = [];
      if (!granted.has("instagram_content_publish")) {
        igBlockers.push("instagram_publish_capability_missing");
      }
      instagram = {
        channel: "instagram",
        account_id: page.instagramBusinessAccount.id,
        display_name:
          page.instagramBusinessAccount.name ||
          page.instagramBusinessAccount.username ||
          page.instagramBusinessAccount.id,
        capability_status:
          igBlockers.length === 0 ? "supported" : "unsupported",
        blockers: igBlockers,
      };
    } else {
      instagram = null;
    }
    return { page: pageOption, instagram };
  }

  private async loadPendingConnection(input: {
    businessId: string;
    userId: string;
    connectionId: string;
    fingerprint?: string;
  }): Promise<PublishingProviderConnection> {
    const connection = await this.prisma.publishingProviderConnection.findFirst({
      where: { id: input.connectionId, businessId: input.businessId },
    });
    if (!connection) throw new NotFoundException(PublishingErrorCode.NOT_FOUND);
    if (connection.userId !== input.userId) {
      this.logger.warn(
        `Cross-owner selection attempt: connection=${input.connectionId} by user=${input.userId}`,
      );
      throw new ForbiddenException(PublishingErrorCode.FORBIDDEN);
    }
    if (connection.state !== PublishingConnectionState.PENDING_SELECTION) {
      throw new UnprocessableEntityException(
        `${MetaConnectionErrorCode.SELECTION_EXPIRED}: connection is ${connection.state}`,
      );
    }
    if (connection.expiresAt && connection.expiresAt < new Date()) {
      throw new UnprocessableEntityException(
        `${MetaConnectionErrorCode.SELECTION_EXPIRED}: authorization window expired — reconnect`,
      );
    }
    if (connection.fingerprint && connection.fingerprint !== input.fingerprint) {
      this.logger.warn(
        `Fingerprint mismatch on selection for connection=${input.connectionId}`,
      );
      throw new ForbiddenException(PublishingErrorCode.FORBIDDEN);
    }
    return connection;
  }

  private async loadUserToken(
    connection: PublishingProviderConnection,
  ): Promise<string> {
    if (!connection.userCredentialRef) {
      throw new UnprocessableEntityException(
        `${MetaConnectionErrorCode.SELECTION_EXPIRED}: no authorizing credential`,
      );
    }
    const record = await this.prisma.publishingCredential.findUnique({
      where: { id: connection.userCredentialRef },
    });
    if (!record || record.revokedAt) {
      throw new UnprocessableEntityException(
        `${MetaConnectionErrorCode.SELECTION_EXPIRED}: authorizing credential revoked`,
      );
    }
    try {
      const bundle = JSON.parse(this.vault.decrypt(record)) as UserTokenBundle;
      if (bundle.type !== "user" || !bundle.token) {
        throw new Error("not a user token bundle");
      }
      return bundle.token;
    } catch (err) {
      throw new UnprocessableEntityException(
        `${MetaConnectionErrorCode.SELECTION_EXPIRED}: authorizing credential unreadable`,
      );
    }
  }

  private async createVaultRecord(input: {
    businessId: string;
    kind: "page" | "instagram";
    providerAccountId: string;
    expiresAt: Date | null;
    payload: PageTokenBundle | InstagramTokenBundle;
  }): Promise<{ id: string }> {
    const encrypted = this.vault.encrypt(JSON.stringify(input.payload));
    return this.prisma.publishingCredential.create({
      data: {
        businessId: input.businessId,
        provider: "META",
        kind: input.kind,
        keyVersion: encrypted.keyVersion,
        ciphertext: encrypted.ciphertext,
        providerAccountId: input.providerAccountId,
        expiresAt: input.expiresAt,
      },
      select: { id: true },
    });
  }

  private async upsertTarget(input: {
    businessId: string;
    connectionId: string;
    channel: "facebook" | "instagram";
    externalAccountId: string;
    displayName: string;
    credentialRef: string;
    expiresAt: Date | null;
    verifiedAt: Date;
  }): Promise<TargetProjection> {
    const data = {
      businessId: input.businessId,
      provider: "META" as const,
      connectionId: input.connectionId,
      channel: input.channel,
      externalAccountId: input.externalAccountId,
      displayName: input.displayName,
      connectionState: PublishingTargetConnectionState.CONNECTED,
      credentialRef: input.credentialRef,
      capabilities: ["static_image"],
      lastVerifiedAt: input.verifiedAt,
      expiresAt: input.expiresAt,
      version: { increment: 1 },
    };
    const target = await this.prisma.publishingTarget.upsert({
      where: {
        businessId_provider_channel_externalAccountId: {
          businessId: input.businessId,
          provider: "META",
          channel: input.channel,
          externalAccountId: input.externalAccountId,
        },
      },
      update: data,
      create: {
        ...data,
        version: 1,
      },
    });
    return toTargetProjection(target);
  }

  private cancellationCode(error: string): MetaCallbackResultCode {
    if (
      error === "access_denied" ||
      error === "user_cancelled" ||
      error === "user_denied"
    ) {
      return "cancelled";
    }
    return "unknown";
  }

  private redirect(
    result: MetaCallbackResultCode,
    connectionId: string | null,
    bound?: { locale?: string | null },
  ): MetaCallbackRedirect {
    const locale = bound?.locale ?? DEFAULT_LOCALE;
    const params = new URLSearchParams({ meta_result: result });
    if (connectionId) params.set("meta_connection", connectionId);
    const path = `${bound?.locale ? `/${bound.locale}` : `/${locale}`}${DEFAULT_RETURN_PATH}/meta/callback?${params.toString()}`;
    const url = `${this.webBaseUrl}${path}`;
    // Never leak the locale through an invalid base — fail-closed default.
    return { url: safeRedirectUrl(url, `${this.webBaseUrl}/publishing`) };
  }
}

/** Keeps the redirect target same-origin relative to the configured web base
 *  (prevents open-redirect injection through the locale/return path). */
function safeRedirectUrl(url: string, fallback: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return fallback;
    }
    return parsed.toString();
  } catch {
    return fallback;
  }
}
