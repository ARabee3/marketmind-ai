import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type {
  PerformanceCapabilityV1,
  PerformanceOverviewV1,
  PerformanceSnapshotProjectionV1,
  PerformanceSyncWindowV1,
} from "@marketmind/contracts";
import { PrismaService } from "../../common/persistence/prisma.service";
import {
  PerformanceRepository,
  PerformanceRepositoryError,
  type PerformancePostsPage,
} from "../publishing/performance/performance.repository";
import { PERFORMANCE_REFRESH_COOLDOWN_MS } from "./performance.constants";
import { PerformanceReconciler } from "./performance.reconciler";

export type PerformanceRefreshResponse = {
  readonly status: "queued" | "not_due" | "rate_limited";
  readonly windows: readonly PerformanceSyncWindowV1[];
};

@Injectable()
export class PerformanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: PerformanceRepository,
    private readonly reconciler: PerformanceReconciler,
  ) {}

  async getOverview(userId: string): Promise<PerformanceOverviewV1> {
    const businessId = await this.businessIdForOwner(userId);
    return this.repository.buildOverview(
      businessId,
      await this.capability(businessId, userId),
    );
  }

  async listPosts(
    userId: string,
    input: { readonly cursor?: string; readonly format?: string },
  ): Promise<PerformancePostsPage> {
    const businessId = await this.businessIdForOwner(userId);
    if (
      input.format &&
      !["text_post", "static_image_post"].includes(input.format)
    ) {
      throw new BadRequestException({
        code: "PERFORMANCE_INVALID_PROVIDER_DATA",
        message: "format must be text_post or static_image_post",
      });
    }
    try {
      return await this.repository.listPostsPage({
        businessId,
        cursor: input.cursor,
        format: input.format,
      });
    } catch (error) {
      this.throwRepositoryError(error);
    }
  }

  async listSnapshots(
    userId: string,
    publishingResultId: string,
  ): Promise<readonly PerformanceSnapshotProjectionV1[]> {
    const businessId = await this.businessIdForOwner(userId);
    const context = await this.repository.getPublicationContext(
      publishingResultId,
      businessId,
    );
    if (!context) throw this.notFound();
    const snapshots = await this.repository.listSnapshotsForResult(
      businessId,
      publishingResultId,
    );
    return snapshots.map((snapshot) => ({
      contract_version: "performance-v1",
      snapshot_id: snapshot.snapshot_id,
      business_id: snapshot.business_id,
      publishing_result_id: snapshot.publishing_result_id,
      provider: snapshot.provider,
      provider_object_id: snapshot.provider_object_id,
      window: snapshot.window,
      published_at: snapshot.published_at,
      observed_at: snapshot.observed_at,
      fetched_at: snapshot.fetched_at,
      metrics: snapshot.metrics,
    }));
  }

  async refresh(
    userId: string,
    publishingResultId: string,
  ): Promise<PerformanceRefreshResponse> {
    const businessId = await this.businessIdForOwner(userId);
    const context = await this.repository.getPublicationContext(
      publishingResultId,
      businessId,
    );
    if (!context) throw this.notFound();
    try {
      await this.repository.ensureSyncWindowsForResult(
        publishingResultId,
        businessId,
      );
      const requested = await this.repository.requestDueRefresh({
        businessId,
        publishingResultId,
        now: new Date(),
        cooldownMs: PERFORMANCE_REFRESH_COOLDOWN_MS,
      });
      const windows = await this.repository.listSyncWindowsForResult(
        businessId,
        publishingResultId,
      );
      if (requested.rateLimited) {
        throw new HttpException(
          {
            code: "PERFORMANCE_PROVIDER_RATE_LIMITED",
            message: "Performance refresh was requested too recently",
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      if (requested.updated === 0) {
        return { status: "not_due", windows };
      }
      await this.reconciler.reconcileOnce();
      return { status: "queued", windows };
    } catch (error) {
      if (
        error instanceof HttpException &&
        error.getStatus() === HttpStatus.TOO_MANY_REQUESTS
      ) {
        throw error;
      }
      this.throwRepositoryError(error);
    }
  }

  private async businessIdForOwner(userId: string): Promise<string> {
    const business = await this.prisma.business.findFirst({
      where: { ownerUserId: userId },
      select: { id: true },
    });
    if (!business) {
      throw new ForbiddenException({
        code: "PUBLISHING_FORBIDDEN_NO_BUSINESS",
        message: "A business profile is required for performance monitoring",
      });
    }
    return business.id;
  }

  private async capability(
    businessId: string,
    ownerUserId: string,
  ): Promise<PerformanceCapabilityV1> {
    const [target, socialConnection, terminalWindows, latestSnapshot] =
      await Promise.all([
        this.prisma.publishingTarget.findFirst({
          where: {
            businessId,
            provider: "META",
            channel: "facebook",
          },
          select: {
            connectionState: true,
            expiresAt: true,
            externalAccountId: true,
          },
        }),
        this.prisma.socialConnection.findUnique({
          where: { userId: ownerUserId },
          select: { pageId: true, isValid: true, expiresAt: true },
        }),
        this.prisma.performanceSyncWindow.findMany({
          where: {
            businessId,
            state: "terminal",
            lastErrorCode: {
              in: [
                "PERFORMANCE_PERMISSION_REQUIRED",
                "PERFORMANCE_PROVIDER_UNAVAILABLE",
                "PERFORMANCE_PROVIDER_RATE_LIMITED",
              ],
            },
          },
          select: { lastErrorCode: true },
        }),
        this.prisma.metricSnapshot.findFirst({
          where: { businessId },
          orderBy: { fetchedAt: "desc" },
          select: { fetchedAt: true },
        }),
      ]);
    const blockers: Array<PerformanceCapabilityV1["blockers"][number]> = [];
    if (!target) {
      blockers.push("no_facebook_connection");
    } else if (
      target.connectionState !== "CONNECTED" ||
      (target.expiresAt && target.expiresAt.getTime() <= Date.now()) ||
      (socialConnection &&
        socialConnection.pageId === target.externalAccountId &&
        (!socialConnection.isValid ||
          (socialConnection.expiresAt &&
            socialConnection.expiresAt.getTime() <= Date.now())))
    ) {
      blockers.push("connection_expired");
    }
    if (
      terminalWindows.some(
        (window) => window.lastErrorCode === "PERFORMANCE_PERMISSION_REQUIRED",
      )
    ) {
      blockers.push("read_insights_permission_missing");
    }
    if (
      terminalWindows.some(
        (window) =>
          window.lastErrorCode === "PERFORMANCE_PROVIDER_UNAVAILABLE" ||
          window.lastErrorCode === "PERFORMANCE_PROVIDER_RATE_LIMITED",
      )
    ) {
      blockers.push("provider_unavailable");
    }
    return {
      status: blockers.length === 0 ? "ready" : "blocked",
      blockers,
      last_successful_sync: latestSnapshot?.fetchedAt.toISOString() ?? null,
    };
  }

  private notFound(): NotFoundException {
    return new NotFoundException({
      code: "PUBLISHING_NOT_FOUND",
      message: "Performance publication was not found",
    });
  }

  private throwRepositoryError(error: unknown): never {
    if (error instanceof PerformanceRepositoryError) {
      if (error.code === "PERFORMANCE_SYNC_WINDOW_CONFLICT") {
        throw new ConflictException({
          code: error.code,
          message: "Performance state conflict",
        });
      }
      throw new BadRequestException({
        code: error.code,
        message:
          error.code === "PERFORMANCE_PROVIDER_RATE_LIMITED"
            ? "Performance refresh is rate limited"
            : "The performance request could not be completed",
      });
    }
    throw error;
  }
}
