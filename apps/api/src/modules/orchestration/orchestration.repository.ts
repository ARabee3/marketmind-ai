import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  CampaignOrchestrationStartV1,
  OrchestrationEventType,
  OrchestrationRole,
  OrchestrationStage,
  OrchestrationStatus,
} from "@marketmind/contracts";
import { PrismaService } from "../../common/persistence/prisma.service";

export type CreateOrchestrationRunInput = {
  readonly id: string;
  readonly businessId: string;
  readonly ownerUserId: string;
  readonly contractVersion: string;
  readonly graphName: string;
  readonly graphVersion: string;
  readonly status: OrchestrationStatus;
  readonly currentRole: OrchestrationRole | null;
  readonly currentStage: OrchestrationStage;
  readonly featureCohort: string;
  readonly checkpointThreadId: string;
  readonly checkpointVersion?: number | null;
  readonly immutableInputRefs: Prisma.InputJsonValue;
  readonly outputRefs: Prisma.InputJsonValue;
  readonly bounds: Prisma.InputJsonValue;
  readonly correlationId: string;
  readonly idempotencyKey: string;
  readonly idempotencyFingerprint: string;
  readonly terminalError?: Prisma.InputJsonValue;
};

export type AppendOrchestrationEventInput = {
  readonly contractVersion: string;
  readonly eventType: OrchestrationEventType;
  readonly status: OrchestrationStatus;
  readonly currentRole: OrchestrationRole | null;
  readonly currentStage: OrchestrationStage;
  readonly node?: string | null;
  readonly tool?: string | null;
  readonly summary: string;
  readonly payload: Prisma.InputJsonValue;
};

type OrchestrationRunRecord = Prisma.OrchestrationRunGetPayload<
  Record<string, never>
>;
type OrchestrationEventRecord = Prisma.OrchestrationEventGetPayload<
  Record<string, never>
>;

export type OrchestrationStartResult = {
  readonly run: OrchestrationRunRecord;
  readonly event: OrchestrationEventRecord | null;
};

@Injectable()
export class OrchestrationRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByIdempotency(
    ownerUserId: string,
    idempotencyKey: string,
  ): Promise<OrchestrationStartResult | null> {
    const run = await this.prisma.orchestrationRun.findUnique({
      where: { ownerUserId_idempotencyKey: { ownerUserId, idempotencyKey } },
    });
    if (!run) return null;

    const event = await this.prisma.orchestrationEvent.findUnique({
      where: { runId_seq: { runId: run.id, seq: 1 } },
    });
    return { run, event };
  }

  async isStartScopeValid(
    input: Pick<
      CampaignOrchestrationStartV1,
      | "business_id"
      | "confirmed_profile_version_id"
      | "confirmed_profile_version"
      | "strategy_id"
      | "strategy_brief_id"
    >,
    ownerUserId: string,
  ): Promise<boolean> {
    const [business, profile, strategy] = await Promise.all([
      this.prisma.business.findFirst({
        where: { id: input.business_id, ownerUserId },
        select: { id: true },
      }),
      this.prisma.businessProfileVersion.findFirst({
        where: {
          id: input.confirmed_profile_version_id,
          businessId: input.business_id,
          version: input.confirmed_profile_version,
          business: { ownerUserId },
        },
        select: { id: true },
      }),
      this.prisma.strategy.findFirst({
        where: {
          id: input.strategy_id,
          businessId: input.business_id,
          ownerUserId,
        },
        select: { brief: { select: { id: true } } },
      }),
    ]);

    return Boolean(
      business &&
      profile &&
      strategy?.brief &&
      strategy.brief.id === input.strategy_brief_id,
    );
  }

  async findByIdAndOwner(
    id: string,
    ownerUserId: string,
  ): Promise<OrchestrationRunRecord | null> {
    return this.prisma.orchestrationRun.findFirst({
      where: { id, ownerUserId },
    });
  }

  /**
   * Creates the run envelope and its first sanitized event in one transaction.
   * A unique idempotency violation is intentionally allowed to bubble to the
   * service, which resolves it to the already committed run.
   */
  async createRunWithInitialEvent(input: CreateOrchestrationRunInput): Promise<{
    readonly run: OrchestrationRunRecord;
    readonly event: OrchestrationEventRecord;
  }> {
    return this.prisma.$transaction(async (tx) => {
      const run = await tx.orchestrationRun.create({
        data: {
          id: input.id,
          businessId: input.businessId,
          ownerUserId: input.ownerUserId,
          contractVersion: input.contractVersion,
          graphName: input.graphName,
          graphVersion: input.graphVersion,
          status: input.status,
          currentRole: input.currentRole,
          currentStage: input.currentStage,
          featureCohort: input.featureCohort,
          checkpointThreadId: input.checkpointThreadId,
          checkpointVersion: input.checkpointVersion ?? null,
          immutableInputRefs: input.immutableInputRefs,
          outputRefs: input.outputRefs,
          bounds: input.bounds,
          correlationId: input.correlationId,
          idempotencyKey: input.idempotencyKey,
          idempotencyFingerprint: input.idempotencyFingerprint,
          ...(input.terminalError
            ? { terminalError: input.terminalError }
            : {}),
        },
      });
      const event = await tx.orchestrationEvent.create({
        data: {
          runId: run.id,
          seq: 1,
          contractVersion: input.contractVersion,
          eventType: "run_created",
          status: input.status,
          currentRole: input.currentRole,
          currentStage: input.currentStage,
          summary: "Orchestration run queued.",
          payload: {},
        },
      });
      return { run, event };
    });
  }

  /**
   * Guards the status write with the observed status so a stale worker cannot
   * advance a run after another worker has already moved it.
   */
  async transitionStatus(
    id: string,
    ownerUserId: string,
    from: OrchestrationStatus,
    to: OrchestrationStatus,
  ): Promise<boolean> {
    const result = await this.prisma.orchestrationRun.updateMany({
      where: { id, ownerUserId, status: from },
      data: { status: to },
    });
    return result.count === 1;
  }

  async updateCheckpoint(
    id: string,
    checkpointVersion: number,
  ): Promise<OrchestrationRunRecord> {
    return this.prisma.orchestrationRun.update({
      where: { id },
      data: { checkpointVersion },
    });
  }

  /**
   * Serializes event numbering behind a row lock on the parent run. The
   * unique (run_id, seq) index remains a final correctness guard.
   */
  async appendEvent(
    runId: string,
    input: AppendOrchestrationEventInput,
  ): Promise<OrchestrationEventRecord> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "orchestration_runs" WHERE "id" = ${runId} FOR UPDATE
      `;
      const latest = await tx.orchestrationEvent.findFirst({
        where: { runId },
        orderBy: { seq: "desc" },
        select: { seq: true },
      });
      return tx.orchestrationEvent.create({
        data: {
          runId,
          seq: (latest?.seq ?? 0) + 1,
          contractVersion: input.contractVersion,
          eventType: input.eventType,
          status: input.status,
          currentRole: input.currentRole,
          currentStage: input.currentStage,
          node: input.node ?? null,
          tool: input.tool ?? null,
          summary: input.summary,
          payload: input.payload,
        },
      });
    });
  }

  async listEvents(runId: string): Promise<OrchestrationEventRecord[]> {
    return this.prisma.orchestrationEvent.findMany({
      where: { runId },
      orderBy: { seq: "asc" },
    });
  }
}
