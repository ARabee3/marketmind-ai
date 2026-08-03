import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { PrismaService } from "../../../common/persistence/prisma.service";
import { ReconciliationService } from "../scheduling/reconciliation.service";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../../rbac/guards/permissions.guard";
import { Permissions } from "../../rbac/decorators/permissions.decorator";
import { PERMISSIONS } from "../../rbac/rbac.constants";
import { IsInt, IsNotEmpty, IsString, Min } from "class-validator";
import { PublishingErrorCode } from "../common/errors/publishing-error-codes";
import { BadRequestException, NotFoundException } from "@nestjs/common";

class ResolveUnknownDto {
  @IsString()
  @IsNotEmpty()
  resolution!: "PUBLISHED" | "FAILED";

  @IsString()
  @IsNotEmpty()
  reason!: string;

  // Provider proof — REQUIRED when resolution === 'PUBLISHED'. Never fabricate
  // a publication without evidence from the provider (anti-pattern §12/G10).
  @IsString()
  @IsNotEmpty()
  remotePublicationId!: string;
}

/**
 * Admin-only endpoints — §9 manual reconciliation entry points.
 *
 * Authorization: a valid access token (JwtAuthGuard) PLUS the
 * `admin:publishing` permission (PermissionsGuard). The `admin` role is the
 * only role granted this permission (see rbac.constants.ts), so ordinary
 * owners and demo developers cannot trigger sweeps, resolve unknown results,
 * or read attempts across businesses. Business-ownership scoping is
 * intentionally NOT applied here because admins operate across all businesses
 * by design — mirroring the existing `admin:manage_library` permission.
 * Per §11, these internal/admin routes must not be reachable through normal
 * owner-session authorization alone.
 */
@Controller("publishing/admin")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reconciliation: ReconciliationService,
  ) {}

  /** Manual trigger for queue-DB reconciliation on one intent. */
  @Post("intents/:intentId/resync-schedule")
  @Permissions(PERMISSIONS.PUBLISHING_ADMIN)
  async resyncIntent(@Param("intentId") intentId: string) {
    return this.reconciliation.resyncIntent(intentId);
  }

  /** Manually close out an UNKNOWN result after human/provider investigation. */
  @Post("results/:resultId/resolve")
  @Permissions(PERMISSIONS.PUBLISHING_ADMIN)
  async resolveUnknown(
    @Param("resultId") resultId: string,
    @Body() dto: ResolveUnknownDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.publishingResult.findUnique({
        where: { id: resultId },
      });
      if (!result) throw new NotFoundException(PublishingErrorCode.NOT_FOUND);

      // ANTI-PATTERN GUARD: only never-settled UNKNOWN outcomes can be resolved,
      // and PUBLISHED is impossible to claim without provider evidence.
      if (result.outcome !== "UNKNOWN") {
        throw new BadRequestException(
          `Result is "${result.outcome}", only UNKNOWN results can be manually resolved`,
        );
      }
      if (dto.resolution === "PUBLISHED" && !dto.remotePublicationId) {
        throw new BadRequestException(
          "Cannot resolve as PUBLISHED without a provider remotePublicationId — provide proof or mark FAILED",
        );
      }

      const newOutcome =
        dto.resolution === "PUBLISHED" ? "PUBLISHED" : "FAILED";
      const updated = await tx.publishingResult.update({
        where: { id: resultId },
        data: {
          outcome: newOutcome as never,
          // Preserve earlier write (don't wipe provider provenance); only settle
          // into a terminal outcome with supporting evidence fields.
          remotePublicationId:
            dto.resolution === "PUBLISHED"
              ? dto.remotePublicationId
              : result.remotePublicationId,
          sanitizedError: dto.reason,
        },
      });

      // Update parent intent
      const intentStatus = newOutcome === "PUBLISHED" ? "SUCCEEDED" : "FAILED";
      await tx.publishingIntent.updateMany({
        where: { id: result.intentId, status: "ACTION_REQUIRED" },
        data: { status: intentStatus as never },
      });

      return updated;
    });
  }

  /** Trigger reconciliation sweep immediately on demand. */
  @Post("sweep")
  @Permissions(PERMISSIONS.PUBLISHING_ADMIN)
  async triggerSweep() {
    await this.reconciliation.runSweep();
    return { ok: true, message: "Reconciliation sweep triggered" };
  }

  /** Read single attempt with its result. */
  @Get("attempts/:attemptId")
  @Permissions(PERMISSIONS.PUBLISHING_ADMIN)
  async getAttempt(@Param("attemptId") attemptId: string) {
    const attempt = await this.prisma.publishingAttempt.findUnique({
      where: { id: attemptId },
      include: { result: true },
    });
    if (!attempt) throw new NotFoundException(PublishingErrorCode.NOT_FOUND);
    return attempt;
  }
}
