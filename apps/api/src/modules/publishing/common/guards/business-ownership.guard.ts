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
 * Guard that runs before every owner-facing handler under /publishing/*.
 *
 * P1 (issue #119 review): `JwtStrategy.validate()` only returns
 * `{ id, email, roles }` — it does NOT carry `businessId`. The frozen
 * publishing routes are business-scoped, so this guard derives the
 * authenticated owner's business from the DB ONCE, attaches it to
 * `req.user.businessId`, and FAILS CLOSED (403) when the owner has no
 * business. Only after a business scope is resolved does it run the
 * per-resource ownership checks (intent/candidate/target/attempt):
 *
 *  - if the route has :intentId/:candidateId/:targetId/:attemptId that
 *    resource's businessId must equal the caller's, otherwise 403 (404 to
 *    avoid enumeration when the resource itself is missing);
 *  - list/create handlers (no resource param) just receive the resolved
 *    business scope from `req.user.businessId`.
 */
@Injectable()
export class BusinessOwnershipGuard implements CanActivate {
  private readonly logger = new Logger(BusinessOwnershipGuard.name);

  constructor(private readonly prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const user = req.user as
      | { id: string; businessId?: string }
      | undefined;

    if (!user?.id) {
      // No authenticated principal — let JwtAuthGuard's 401 stand; nothing to scope.
      return true;
    }

    // Resolve the caller's business scope, fail closed when absent.
    if (!user.businessId) {
      const business = await this.prisma.business.findFirst({
        where: { ownerUserId: user.id },
        select: { id: true },
      });
      if (!business) {
        this.logger.warn(
          `Owner ${user.id} has no business scope for publishing routes`,
        );
        throw new ForbiddenException(
          PublishingErrorCode.FORBIDDEN_NO_BUSINESS,
        );
      }
      // Attach the resolved scope so downstream handlers/services read it.
      user.businessId = business.id;
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
