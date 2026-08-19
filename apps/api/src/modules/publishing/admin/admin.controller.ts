import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { PrismaService } from "../../../common/persistence/prisma.service";
import { ReconciliationService } from "../scheduling/reconciliation.service";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../../rbac/guards/permissions.guard";
import { Permissions } from "../../rbac/decorators/permissions.decorator";
import { PERMISSIONS } from "../../rbac/rbac.constants";
import { IsNotEmpty, IsOptional, IsString } from "class-validator";
import { PublishingErrorCode } from "../common/errors/publishing-error-codes";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { ListResultsQueryDto } from "./dto/list-results-query.dto";

class ResolveUnknownDto {
  @IsString()
  @IsNotEmpty()
  resolution!: "PUBLISHED" | "FAILED";

  @IsString()
  @IsNotEmpty()
  reason!: string;

  // Provider proof — REQUIRED when resolution === 'PUBLISHED' (enforced by the
  // controller). Optional when resolving as FAILED. Never fabricate a
  // publication without evidence from the provider (anti-pattern §12/G10).
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  remotePublicationId?: string;
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

  /**
   * List results across all businesses, newest first. Admin-only (§9) —
   * ownership scoping is intentionally NOT applied because admins reconcile
   * on behalf of every business. `outcome` filters (e.g. UNKNOWN surfaces the
   * reconciliation queue); pagination matches the other admin lists.
   */
  @Get("results")
  @Permissions(PERMISSIONS.PUBLISHING_ADMIN)
  async listResults(@Query() query: ListResultsQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where = query.outcome ? { outcome: query.outcome } : {};

    const [total, items] = await Promise.all([
      this.prisma.publishingResult.count({ where }),
      this.prisma.publishingResult.findMany({
        where,
        orderBy: { occurredAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          attempt: {
            select: {
              id: true,
              status: true,
              attemptSequence: true,
              sanitizedError: true,
              startedAt: true,
              finishedAt: true,
              intent: {
                select: {
                  id: true,
                  status: true,
                  mode: true,
                  scheduledUtcAt: true,
                  version: true,
                  businessId: true,
                  candidate: {
                    select: {
                      id: true,
                      channel: true,
                      format: true,
                      locale: true,
                    },
                  },
                  target: {
                    select: {
                      id: true,
                      provider: true,
                      channel: true,
                      displayName: true,
                    },
                  },
                },
              },
            },
          },
        },
      }),
    ]);

    // The Intent model carries only a businessId scalar (no relation), so the
    // display names are resolved in one small batched read and attached to the
    // response payload for the admin console — never used for authorization.
    const businessIds = [
      ...new Set(
        items
          .map((item) => item.attempt.intent.businessId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const businesses = businessIds.length
      ? await this.prisma.business.findMany({
          where: { id: { in: businessIds } },
          select: { id: true, displayName: true },
        })
      : [];
    const businessById = new Map(businesses.map((b) => [b.id, b]));

    const serialized = items.map((item) => ({
      ...item,
      intent: {
        ...item.attempt.intent,
        business: businessById.get(item.attempt.intent.businessId) ?? null,
      },
    }));

    return { items: serialized, total, page, pageSize };
  }
}
