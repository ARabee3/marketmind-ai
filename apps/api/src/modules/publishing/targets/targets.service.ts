import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { PublishingTarget } from "@prisma/client";
import { PrismaService } from "../../../common/persistence/prisma.service";
import {
  CreateTargetDto,
  TargetProjection,
  UpdateTargetConnectionStateDto,
  VerifyTargetDto,
} from "./targets.dto";
import { PublishingErrorCode } from "../common/errors/publishing-error-codes";

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

  constructor(private readonly prisma: PrismaService) {}

  async createTarget(dto: CreateTargetDto): Promise<TargetProjection> {
    const raw = await this.prisma.publishingTarget.create({
      data: {
        businessId: dto.businessId,
        provider: dto.provider,
        channel: dto.channel,
        externalAccountId: dto.externalAccountId,
        displayName: dto.displayName,
        credentialRef: dto.credentialRef,
        capabilities: dto.capabilities ?? ["static_image"],
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      },
    });
    return toTargetProjection(raw);
  }

  async listTargets(businessId: string): Promise<TargetProjection[]> {
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
    const raw = await this.prisma.publishingTarget.findFirst({
      where: { id: targetId, businessId },
    });
    if (!raw) throw new NotFoundException(PublishingErrorCode.NOT_FOUND);
    return toTargetProjection(raw);
  }

  async updateConnectionState(
    targetId: string,
    businessId: string,
    dto: UpdateTargetConnectionStateDto,
  ): Promise<TargetProjection> {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.publishingTarget.findUniqueOrThrow({
        where: { id: targetId },
      });
      // Ownership: a connection-state mutation is cross-tenant-safe scoped to
      // the owning business (issue #119 G10). 404 (not 403) avoids enumeration.
      if (current.businessId !== businessId) {
        throw new NotFoundException(PublishingErrorCode.NOT_FOUND);
      }
      if (current.version !== dto.currentVersion) {
        throw new ConflictException(PublishingErrorCode.VERSION_CONFLICT);
      }
      const updated = await tx.publishingTarget.update({
        where: { id: targetId },
        data: {
          connectionState: dto.connectionState,
          version: { increment: 1 },
          expiresAt: dto.expiresAt
            ? new Date(dto.expiresAt)
            : current.expiresAt,
          lastVerifiedAt: new Date(),
        },
      });
      return toTargetProjection(updated);
    });
  }

  async deleteTarget(targetId: string, businessId: string): Promise<void> {
    const target = await this.prisma.publishingTarget.findFirst({
      where: { id: targetId, businessId },
    });
    if (!target) throw new NotFoundException(PublishingErrorCode.NOT_FOUND);
    await this.prisma.publishingTarget.delete({ where: { id: targetId } });
  }

  /**
   * Frozen verify route (POST /publishing-targets/:targetId/verify, §2.2).
   *
   * Deterministic local connectivity probe: ownership-scoped, guarded by the
   * pipeline's version-conflict rule (`expected_target_version`), and only
   * stamps `lastVerifiedAt` when the target is in a usable state. A live
   * provider round-trip is owned by the n8n boundary in a later slice — this
   * endpoint never invents credentials or claims connectivity it can't prove.
   */
  async verifyTarget(
    targetId: string,
    businessId: string,
    dto: VerifyTargetDto,
  ): Promise<{ target: TargetProjection; verifiedAt: Date }> {
    const verifiedAt = new Date();
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.publishingTarget.findUniqueOrThrow({
        where: { id: targetId },
      });
      if (current.businessId !== businessId) {
        throw new NotFoundException(PublishingErrorCode.NOT_FOUND);
      }
      if (current.version !== dto.expectedTargetVersion) {
        throw new ConflictException(PublishingErrorCode.VERSION_CONFLICT);
      }
      if (current.connectionState !== "CONNECTED") {
        throw new UnprocessableEntityException(
          PublishingErrorCode.TARGET_NOT_CONNECTED,
        );
      }
      if (current.expiresAt && current.expiresAt < verifiedAt) {
        throw new UnprocessableEntityException(
          PublishingErrorCode.TARGET_UNAUTHORIZED,
        );
      }
      const updated = await tx.publishingTarget.update({
        where: { id: targetId },
        data: { lastVerifiedAt: verifiedAt, version: { increment: 1 } },
      });
      return { target: toTargetProjection(updated), verifiedAt };
    });
  }

  /**
   * Used by the dispatch processor during revalidation.
   * Returns raw entity (includes credentialRef) — never expose to HTTP layer.
   */
  async assertTargetActive(targetId: string): Promise<PublishingTarget> {
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
