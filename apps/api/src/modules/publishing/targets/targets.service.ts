import {
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { PublishingTarget } from "@prisma/client";
import { PrismaService } from "../../../common/persistence/prisma.service";
import { TargetProjection } from "./targets.dto";
import { PublishingErrorCode } from "../common/errors/publishing-error-codes";
import { FacebookTargetBridgeService } from "./facebook-target-bridge.service";

/**
 * Allow-list projector: the ONLY path through which target data leaves this service.
 * `credentialRef` is statically excluded. If a new column is added to PublishingTarget
 * and it contains sensitive data, it will NOT appear here until explicitly added —
 * this is the allow-list guarantee from the implementation plan §2.2.
 */
export function toTargetProjection(target: PublishingTarget): TargetProjection {
  return {
    id: target.id,
    businessId: target.businessId,
    provider: target.provider,
    channel: target.channel,
    externalAccountId: target.externalAccountId,
    displayName: target.displayName,
    connectionState: target.connectionState,
    capabilities: target.capabilities,
    lastVerifiedAt: target.lastVerifiedAt,
    expiresAt: target.expiresAt,
    version: target.version,
    createdAt: target.createdAt,
    updatedAt: target.updatedAt,
    // credentialRef is intentionally ABSENT
  };
}

@Injectable()
export class TargetsService {
  private readonly logger = new Logger(TargetsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly facebookBridge: FacebookTargetBridgeService,
  ) {}

  async listTargets(businessId: string): Promise<TargetProjection[]> {
    await this.facebookBridge.syncForBusiness(businessId);
    const raw = await this.prisma.publishingTarget.findMany({
      where: { businessId },
      orderBy: { createdAt: "desc" },
    });
    return raw.map(toTargetProjection);
  }

  async getTarget(
    targetId: string,
    businessId: string,
  ): Promise<TargetProjection> {
    await this.facebookBridge.syncForBusiness(businessId);
    const raw = await this.prisma.publishingTarget.findFirst({
      where: { id: targetId, businessId },
    });
    if (!raw) throw new NotFoundException(PublishingErrorCode.NOT_FOUND);
    return toTargetProjection(raw);
  }

  /**
   * Used by the dispatch processor during revalidation.
   * Returns raw entity (includes credentialRef) — never expose to HTTP layer.
   */
  async assertTargetActive(targetId: string): Promise<PublishingTarget> {
    await this.facebookBridge.syncTarget(targetId);
    const target = await this.prisma.publishingTarget.findUnique({
      where: { id: targetId },
    });
    if (!target)
      throw new UnprocessableEntityException(
        PublishingErrorCode.TARGET_NOT_CONNECTED,
      );
    if (target.connectionState !== "CONNECTED") {
      throw new UnprocessableEntityException(
        PublishingErrorCode.TARGET_UNAUTHORIZED,
      );
    }
    if (target.expiresAt && target.expiresAt < new Date()) {
      throw new UnprocessableEntityException(
        PublishingErrorCode.TARGET_UNAUTHORIZED,
      );
    }
    return target;
  }
}
