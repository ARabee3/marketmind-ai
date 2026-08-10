import { Injectable, Logger } from "@nestjs/common";
import {
  PublishingTargetConnectionState,
  PublishingTargetProvider,
} from "@prisma/client";

import { PrismaService } from "../../../common/persistence/prisma.service";
import { PublishingErrorCode } from "../common/errors/publishing-error-codes";
import { facebookSocialConnectionRef } from "./facebook-target-ref";

const FACEBOOK_CHANNEL = "facebook";
const FACEBOOK_CAPABILITIES = ["static_image", "text"] as const;

/**
 * Materializes the Facebook Page connection from PR #193 into the existing
 * publishing-target boundary.
 *
 * SocialConnection remains the source of truth for the owner connection and
 * encrypted Page token. The PublishingTarget is only a business-scoped,
 * non-secret projection that lets the existing intent/approval/dispatch flow
 * bind a target id. Its credentialRef is an opaque SocialConnection pointer;
 * the dispatch executor resolves that pointer server-side and never treats it
 * as a vault id or token.
 */
@Injectable()
export class FacebookTargetBridgeService {
  private readonly logger = new Logger(FacebookTargetBridgeService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Synchronizes the owner's PR #193 Facebook connection into a target for
   * this business. The method is idempotent and safe to call before every
   * target listing; it never returns or logs credential material.
   */
  async syncForBusiness(businessId: string): Promise<void> {
    const business = await this.prisma.business.findUnique({
      where: { id: businessId },
      select: { ownerUserId: true },
    });
    if (!business) return;

    const connection = await this.prisma.socialConnection.findUnique({
      where: { userId: business.ownerUserId },
    });
    const existing = await this.prisma.publishingTarget.findMany({
      where: {
        businessId,
        provider: PublishingTargetProvider.META,
        channel: FACEBOOK_CHANNEL,
      },
    });

    const bridged = existing.filter((target) =>
      target.credentialRef.startsWith("facebook-social-connection:"),
    );

    if (!connection || connection.provider !== "facebook") {
      await this.expireBridgedTargets(bridged);
      return;
    }

    const state = connection.isValid
      ? PublishingTargetConnectionState.CONNECTED
      : PublishingTargetConnectionState.EXPIRED;
    const lastVerifiedAt = connection.lastTestedAt ?? connection.connectedAt;
    const reference = facebookSocialConnectionRef(connection.id);
    const current = existing.find(
      (target) => target.externalAccountId === connection.pageId,
    );
    const changed =
      !current ||
      current.displayName !== connection.pageName ||
      current.connectionState !== state ||
      current.credentialRef !== reference ||
      JSON.stringify(current.capabilities) !==
        JSON.stringify(FACEBOOK_CAPABILITIES) ||
      current.lastVerifiedAt?.getTime() !== lastVerifiedAt.getTime();

    await this.prisma.publishingTarget.upsert({
      where: {
        businessId_provider_channel_externalAccountId: {
          businessId,
          provider: PublishingTargetProvider.META,
          channel: FACEBOOK_CHANNEL,
          externalAccountId: connection.pageId,
        },
      },
      create: {
        businessId,
        provider: PublishingTargetProvider.META,
        channel: FACEBOOK_CHANNEL,
        externalAccountId: connection.pageId,
        displayName: connection.pageName,
        connectionState: state,
        credentialRef: reference,
        capabilities: [...FACEBOOK_CAPABILITIES],
        lastVerifiedAt,
      },
      update: {
        displayName: connection.pageName,
        connectionState: state,
        credentialRef: reference,
        capabilities: [...FACEBOOK_CAPABILITIES],
        lastVerifiedAt,
        // A changed SocialConnection (reconnect or reactive expiry) is a new
        // target snapshot and must invalidate any stale owner approval. A
        // read-only target listing must not invalidate an unchanged approval.
        ...(changed ? { version: { increment: 1 } } : {}),
      },
    });

    // A user can only connect one Page through PR #193. Any previous bridged
    // Page is no longer selectable and must not remain dispatchable.
    await this.expireBridgedTargets(
      bridged.filter((target) => target.externalAccountId !== connection.pageId),
    );
  }

  /** Sync one target before dispatch-time state is trusted. */
  async syncTarget(targetId: string): Promise<void> {
    const target = await this.prisma.publishingTarget.findUnique({
      where: { id: targetId },
      select: { businessId: true, credentialRef: true },
    });
    if (!target || !target.credentialRef.startsWith("facebook-social-connection:")) {
      return;
    }
    await this.syncForBusiness(target.businessId);
  }

  private async expireBridgedTargets(
    targets: Array<{ id: string; connectionState: PublishingTargetConnectionState }>,
  ): Promise<void> {
    const candidates = targets.filter(
      (target) => target.connectionState === PublishingTargetConnectionState.CONNECTED,
    );
    if (candidates.length === 0) return;
    await this.prisma.publishingTarget.updateMany({
      where: { id: { in: candidates.map((target) => target.id) } },
      data: {
        connectionState: PublishingTargetConnectionState.EXPIRED,
        version: { increment: 1 },
      },
    });
    this.logger.log(
      `${PublishingErrorCode.TARGET_UNAUTHORIZED}: expired ${candidates.length} bridged Facebook target(s)`,
    );
  }
}
