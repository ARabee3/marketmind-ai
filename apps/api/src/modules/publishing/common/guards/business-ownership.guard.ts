import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../../../../common/persistence/prisma.service";
import { PublishingErrorCode } from "../errors/publishing-error-codes";

/**
 * Guard that runs before every handler under /publishing/*.
 * Requires the route to have :intentId, :candidateId, :targetId, or :attemptId
 * as a param — whichever is present is used to resolve the owning businessId,
 * which is then compared to the authenticated user's businessId.
 *
 * If none of these params are present the guard passes (list/create endpoints
 * scope themselves by businessId in the query/body instead).
 */
@Injectable()
export class BusinessOwnershipGuard implements CanActivate {
  private readonly logger = new Logger(BusinessOwnershipGuard.name);

  constructor(private readonly prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const user = req.user as { id: string; businessId?: string } | undefined;

    if (!user?.businessId) {
      // No business context — guard cannot verify; defer to service layer
      return true;
    }

    const params = req.params as Record<string, string>;

    if (params["intentId"]) {
      await this.assertIntentOwnership(params["intentId"], user.businessId);
    } else if (params["candidateId"]) {
      await this.assertCandidateOwnership(
        params["candidateId"],
        user.businessId,
      );
    } else if (params["targetId"]) {
      await this.assertTargetOwnership(params["targetId"], user.businessId);
    } else if (params["attemptId"]) {
      await this.assertAttemptOwnership(params["attemptId"], user.businessId);
    }

    return true;
  }

  private async assertIntentOwnership(
    intentId: string,
    businessId: string,
  ): Promise<void> {
    const intent = await this.prisma.publishingIntent.findUnique({
      where: { id: intentId },
      select: { businessId: true },
    });
    if (!intent) throw new NotFoundException(PublishingErrorCode.NOT_FOUND);
    if (intent.businessId !== businessId) {
      this.logger.warn(
        `Cross-tenant access attempt: intent ${intentId} by business ${businessId}`,
      );
      throw new ForbiddenException(PublishingErrorCode.FORBIDDEN);
    }
  }

  private async assertCandidateOwnership(
    candidateId: string,
    businessId: string,
  ): Promise<void> {
    const candidate = await this.prisma.publishingCandidate.findUnique({
      where: { id: candidateId },
      select: { businessId: true },
    });
    if (!candidate) throw new NotFoundException(PublishingErrorCode.NOT_FOUND);
    if (candidate.businessId !== businessId) {
      this.logger.warn(
        `Cross-tenant access attempt: candidate ${candidateId} by business ${businessId}`,
      );
      throw new ForbiddenException(PublishingErrorCode.FORBIDDEN);
    }
  }

  private async assertTargetOwnership(
    targetId: string,
    businessId: string,
  ): Promise<void> {
    const target = await this.prisma.publishingTarget.findUnique({
      where: { id: targetId },
      select: { businessId: true },
    });
    if (!target) throw new NotFoundException(PublishingErrorCode.NOT_FOUND);
    if (target.businessId !== businessId) {
      this.logger.warn(
        `Cross-tenant access attempt: target ${targetId} by business ${businessId}`,
      );
      throw new ForbiddenException(PublishingErrorCode.FORBIDDEN);
    }
  }

  private async assertAttemptOwnership(
    attemptId: string,
    businessId: string,
  ): Promise<void> {
    const attempt = await this.prisma.publishingAttempt.findUnique({
      where: { id: attemptId },
      include: { intent: { select: { businessId: true } } },
    });
    if (!attempt) throw new NotFoundException(PublishingErrorCode.NOT_FOUND);
    if (attempt.intent.businessId !== businessId) {
      this.logger.warn(
        `Cross-tenant access attempt: attempt ${attemptId} by business ${businessId}`,
      );
      throw new ForbiddenException(PublishingErrorCode.FORBIDDEN);
    }
  }
}
