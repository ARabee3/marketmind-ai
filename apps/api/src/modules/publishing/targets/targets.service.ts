import {
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { PublishingTarget } from "@prisma/client";
import { PrismaService } from "../../../common/persistence/prisma.service";
import {
  TargetProjection,
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

  async deleteTarget(targetId: string, businessId: string): Promise<void> {
    const target = await this.prisma.publishingTarget.findFirst({
      where: { id: targetId, businessId },
    });
    if (!target) throw new NotFoundException(PublishingErrorCode.NOT_FOUND);
    await this.prisma.publishingTarget.delete({ where: { id: targetId } });
  }

  /**
   * Frozen `POST /publishing-targets/meta/connect` — the provider OAuth
   * boundary that initiates account-ownership proof and creates the opaque
   * credential reference. The owner browser NEVER supplies `credentialRef`.
   *
   * The real Meta OAuth integration is owned by the runner/provider boundary
   * issues (#120 / #122); this slice surfaces a clear 501 instead of
   * fabricating a credential or a signed authorization URL (anti-pattern:
   * never present a fake provider connection as real). When #120 lands, this
   * method returns the OAuth authorization URL consumed by the browser.
   */
  async connectMetaTarget(
    _businessId: string,
    _provider: string,
    _channel: string,
  ): Promise<never> {
    this.logger.warn(
      "meta/connect invoked but Meta OAuth is not integrated in this slice (see #120/#122)",
    );
    throw new HttpException(
      {
        statusCode: HttpStatus.NOT_IMPLEMENTED,
        code: PublishingErrorCode.CONTRACT_UNSUPPORTED,
        message:
          "Meta OAuth connect is not integrated in this slice — see issues #120/#122.",
      },
      HttpStatus.NOT_IMPLEMENTED,
    );
  }

  /**
   * Frozen `POST /publishing-targets/meta/callback` — completes the OAuth
   * boundary, proves account ownership, and creates the CONNECTED target row
   * with the provider-derived opaque credential reference. See connectMetaTarget
   * for the integration status; this slice surfaces a clear 501.
   */
  async completeMetaCallback(
    _businessId: string,
    _provider: string,
    _channel: string,
    _code: string,
    _state: string,
  ): Promise<never> {
    this.logger.warn(
      "meta/callback invoked but Meta OAuth is not integrated in this slice (see #120/#122)",
    );
    throw new HttpException(
      {
        statusCode: HttpStatus.NOT_IMPLEMENTED,
        code: PublishingErrorCode.CONTRACT_UNSUPPORTED,
        message:
          "Meta OAuth callback is not integrated in this slice — see issues #120/#122.",
      },
      HttpStatus.NOT_IMPLEMENTED,
    );
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
