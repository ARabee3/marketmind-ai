import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../common/persistence/prisma.service";
import { AuditService } from "../audit/audit.service";

export type BillingAccountSummary = {
  id: string;
  ownerUserId: string;
  ownerEmail: string | null;
  ownerFullName: string | null;
  status: string;
  pausedReason: string | null;
  pausedAt: Date | null;
  createdAt: Date;
};

export type PauseAccountResult = {
  id: string;
  status: string;
  pausedReason: string | null;
  pausedAt: Date | null;
};

export type ResumeAccountResult = {
  id: string;
  status: string;
  pausedReason: null;
  pausedAt: null;
};

export type CostAlert = {
  billingAccountId: string;
  ownerEmail: string | null;
  ownerFullName: string | null;
  billingPeriodStart: Date;
  totalEgpCost: number | null;
  artifactCount: number;
  highRetryArtifacts: number;
  reason: string;
};

export type CostAlertSummary = {
  alerts: CostAlert[];
  cohort95thPercentileEgp: number | null;
  totalAccountsAboveEgp50: number;
  totalHighRetryArtifacts: number;
};

export type ReconciliationMismatch = {
  billingAccountId: string;
  ownerEmail: string | null;
  mismatchType:
    | "succeeded_attempt_no_transaction"
    | "processed_event_no_transaction"
    | "transaction_no_event";
  attemptId: string | null;
  eventId: string | null;
  transactionId: string | null;
  providerCheckoutRef: string | null;
  occurredAt: Date | null;
};

@Injectable()
export class AdminBillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async pauseAccount(
    id: string,
    reason: string,
    actorUserId: string,
    actorEmail: string,
  ): Promise<PauseAccountResult> {
    const account = await this.prisma.billingAccount.findUnique({
      where: { id },
      include: {
        ownerUser: { select: { email: true, fullName: true } },
      },
    });
    if (!account) {
      throw new NotFoundException("Billing account not found");
    }

    const beforeState = {
      status: account.status,
      pausedReason: account.pausedReason,
      pausedAt: account.pausedAt,
    };

    const updated = await this.prisma.billingAccount.update({
      where: { id },
      data: {
        status: "paused",
        pausedReason: reason,
        pausedAt: new Date(),
      },
    });

    await this.auditService.record({
      actorUserId,
      actorEmail,
      action: "billing.pause",
      targetType: "billing_account",
      targetId: id,
      reason,
      beforeState,
      afterState: {
        status: updated.status,
        pausedReason: updated.pausedReason,
        pausedAt: updated.pausedAt,
      },
    });

    return {
      id: updated.id,
      status: updated.status,
      pausedReason: updated.pausedReason,
      pausedAt: updated.pausedAt,
    };
  }

  async resumeAccount(
    id: string,
    actorUserId: string,
    actorEmail: string,
  ): Promise<ResumeAccountResult> {
    const account = await this.prisma.billingAccount.findUnique({
      where: { id },
      include: {
        ownerUser: { select: { email: true, fullName: true } },
      },
    });
    if (!account) {
      throw new NotFoundException("Billing account not found");
    }

    const beforeState = {
      status: account.status,
      pausedReason: account.pausedReason,
      pausedAt: account.pausedAt,
    };

    const updated = await this.prisma.billingAccount.update({
      where: { id },
      data: {
        status: "active",
        pausedReason: null,
        pausedAt: null,
      },
    });

    await this.auditService.record({
      actorUserId,
      actorEmail,
      action: "billing.resume",
      targetType: "billing_account",
      targetId: id,
      reason: null,
      beforeState,
      afterState: {
        status: updated.status,
        pausedReason: updated.pausedReason,
        pausedAt: updated.pausedAt,
      },
    });

    return {
      id: updated.id,
      status: updated.status,
      pausedReason: null,
      pausedAt: null,
    };
  }

  async listCostAlerts(): Promise<CostAlertSummary> {
    const now = new Date();
    const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

    const rows = await this.prisma.billingProviderCostLedger.findMany({
      where: { billingPeriodStart: periodStart },
      include: {
        billingAccount: {
          include: {
            ownerUser: { select: { email: true, fullName: true } },
          },
        },
      },
    });

    const accountMap = new Map<
      string,
      {
        ownerEmail: string | null;
        ownerFullName: string | null;
        billingPeriodStart: Date;
        totalEgpCost: number;
        artifactCount: number;
        highRetryArtifacts: number;
      }
    >();

    const highRetryAlerts: CostAlert[] = [];

    for (const row of rows) {
      const { billingAccountId } = row;
      if (!accountMap.has(billingAccountId)) {
        accountMap.set(billingAccountId, {
          ownerEmail: row.billingAccount.ownerUser?.email ?? null,
          ownerFullName: row.billingAccount.ownerUser?.fullName ?? null,
          billingPeriodStart: row.billingPeriodStart,
          totalEgpCost: 0,
          artifactCount: 0,
          highRetryArtifacts: 0,
        });
      }
      const entry = accountMap.get(billingAccountId)!;

      if (row.egpCost !== null) {
        entry.totalEgpCost += Number(row.egpCost);
      }
      entry.artifactCount += 1;

      if (row.retryCount > 1) {
        entry.highRetryArtifacts += 1;
        highRetryAlerts.push({
          billingAccountId,
          ownerEmail: entry.ownerEmail,
          ownerFullName: entry.ownerFullName,
          billingPeriodStart: entry.billingPeriodStart,
          totalEgpCost: entry.totalEgpCost,
          artifactCount: entry.artifactCount,
          highRetryArtifacts: entry.highRetryArtifacts,
          reason: `artifact_used_${row.retryCount}_attempts`,
        });
      }
    }

    const egpCostByAccount: number[] = [];
    const alerts: CostAlert[] = [];
    let totalAccountsAboveEgp50 = 0;

    for (const [billingAccountId, entry] of accountMap) {
      egpCostByAccount.push(entry.totalEgpCost);

      if (entry.totalEgpCost > 50) {
        totalAccountsAboveEgp50 += 1;
        alerts.push({
          billingAccountId,
          ownerEmail: entry.ownerEmail,
          ownerFullName: entry.ownerFullName,
          billingPeriodStart: entry.billingPeriodStart,
          totalEgpCost: entry.totalEgpCost,
          artifactCount: entry.artifactCount,
          highRetryArtifacts: entry.highRetryArtifacts,
          reason: "monthly_cost_exceeded_egp_50",
        });
      }
    }

    for (const alert of highRetryAlerts) {
      if (!alerts.some((a) => a.billingAccountId === alert.billingAccountId)) {
        alerts.push(alert);
      }
    }

    let cohort95thPercentileEgp: number | null = null;
    if (egpCostByAccount.length > 0) {
      const sorted = egpCostByAccount.sort((a, b) => a - b);
      const p95Index = Math.ceil(sorted.length * 0.95) - 1;
      cohort95thPercentileEgp = sorted[p95Index] ?? null;
    }

    return {
      alerts,
      cohort95thPercentileEgp,
      totalAccountsAboveEgp50,
      totalHighRetryArtifacts: highRetryAlerts.length,
    };
  }

  async listReconciliationMismatches(): Promise<ReconciliationMismatch[]> {
    const periodStart = new Date(Date.UTC(2020, 0, 1));

    const mismatches: ReconciliationMismatch[] = [];

    const succeededAttempts = await this.prisma.billingCheckoutAttempt.findMany({
      where: {
        status: "succeeded",
        createdAt: { gte: periodStart },
      },
      include: {
        billingAccount: {
          include: {
            ownerUser: { select: { email: true } },
          },
        },
        transactions: { select: { id: true } },
      },
    });

    for (const attempt of succeededAttempts) {
      if (attempt.transactions.length === 0) {
        mismatches.push({
          billingAccountId: attempt.billingAccountId,
          ownerEmail: attempt.billingAccount.ownerUser?.email ?? null,
          mismatchType: "succeeded_attempt_no_transaction",
          attemptId: attempt.id,
          eventId: null,
          transactionId: null,
          providerCheckoutRef: attempt.providerCheckoutRef,
          occurredAt: attempt.confirmedAt ?? attempt.updatedAt,
        });
      }
    }

    const processedEvents = await this.prisma.billingProviderEvent.findMany({
      where: {
        status: "processed",
        receivedAt: { gte: periodStart },
      },
      include: {
        billingAccount: {
          include: {
            ownerUser: { select: { email: true } },
          },
        },
      },
    });

    for (const event of processedEvents) {
      const attemptRef = (event.payload as Record<string, unknown>)?.merchant_reference as
        | string
        | undefined;

      if (!attemptRef) continue;

      const attempt = await this.prisma.billingCheckoutAttempt.findFirst({
        where: { id: attemptRef },
        include: { transactions: { select: { id: true } } },
      });

      if (attempt && attempt.transactions.length === 0) {
        mismatches.push({
          billingAccountId: event.billingAccountId ?? "",
          ownerEmail: event.billingAccount?.ownerUser?.email ?? null,
          mismatchType: "processed_event_no_transaction",
          attemptId: attemptRef,
          eventId: event.id,
          transactionId: null,
          providerCheckoutRef: attempt.providerCheckoutRef,
          occurredAt: event.processedAt ?? event.receivedAt,
        });
      }
    }

    const transactionsWithAttempts = await this.prisma.billingPaymentTransaction.findMany({
      where: {
        occurredAt: { gte: periodStart },
        checkoutAttemptId: { not: null },
      },
      include: {
        billingAccount: {
          include: {
            ownerUser: { select: { email: true } },
            providerEvents: {
              where: { status: "processed" },
              select: { id: true },
            },
          },
        },
        checkout: {
          select: {
            id: true,
            providerCheckoutRef: true,
            status: true,
          },
        },
      },
    });

    for (const tx of transactionsWithAttempts) {
      if (!tx.checkout) {
        mismatches.push({
          billingAccountId: tx.billingAccountId,
          ownerEmail: tx.billingAccount.ownerUser?.email ?? null,
          mismatchType: "transaction_no_event",
          attemptId: tx.checkoutAttemptId,
          eventId: null,
          transactionId: tx.id,
          providerCheckoutRef: null,
          occurredAt: tx.occurredAt,
        });
      } else {
        const eventMatch = tx.billingAccount.providerEvents.find(
          (e) => true,
        );
        if (!eventMatch) {
          mismatches.push({
            billingAccountId: tx.billingAccountId,
            ownerEmail: tx.billingAccount.ownerUser?.email ?? null,
            mismatchType: "transaction_no_event",
            attemptId: tx.checkoutAttemptId,
            eventId: null,
            transactionId: tx.id,
            providerCheckoutRef: tx.checkout.providerCheckoutRef,
            occurredAt: tx.occurredAt,
          });
        }
      }
    }

    return mismatches;
  }

  async getAccountById(id: string): Promise<BillingAccountSummary | null> {
    const account = await this.prisma.billingAccount.findUnique({
      where: { id },
      include: {
        ownerUser: { select: { email: true, fullName: true } },
      },
    });
    if (!account) return null;
    return {
      id: account.id,
      ownerUserId: account.ownerUserId,
      ownerEmail: account.ownerUser?.email ?? null,
      ownerFullName: account.ownerUser?.fullName ?? null,
      status: account.status,
      pausedReason: account.pausedReason,
      pausedAt: account.pausedAt,
      createdAt: account.createdAt,
    };
  }
}
