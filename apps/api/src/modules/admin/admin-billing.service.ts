import { randomUUID } from "node:crypto";
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

export type BillingAccountRow = {
  id: string;
  ownerUserId: string;
  ownerEmail: string | null;
  ownerFullName: string | null;
  status: string;
  pausedReason: string | null;
  pausedAt: Date | null;
  createdAt: Date;
};

export type BillingAccountListResponse = {
  items: BillingAccountRow[];
  total: number;
  page: number;
  pageSize: number;
};

export type WalletBalanceRow = {
  accountId: string;
  ownerUserId: string;
  ownerEmail: string | null;
  ownerFullName: string | null;
  status: string;
  balance: number;
  lifetimeGranted: number;
  lifetimeSpent: number;
  createdAt: Date;
};

export type WalletBalanceListResponse = {
  items: WalletBalanceRow[];
  total: number;
  page: number;
  pageSize: number;
};

export type WalletOverview = {
  totalAccounts: number;
  activeAccounts: number;
  pausedAccounts: number;
  totalPointsOutstanding: number;
  totalLifetimeGranted: number;
  totalLifetimeSpent: number;
  totalTopUpEgp: number;
  totalTopUpCount: number;
};

export type WalletLedgerRow = {
  id: string;
  direction: string;
  reason: string;
  metric: string | null;
  points: number;
  balanceAfter: number;
  claimKey: string;
  expiresAt: Date | null;
  createdAt: Date;
};

export type WalletTransactionRow = {
  id: string;
  accountId: string;
  ownerEmail: string | null;
  ownerFullName: string | null;
  provider: string;
  providerTransactionId: string;
  kind: string;
  status: string;
  amountEgp: number;
  currency: string;
  paymentMode: string | null;
  occurredAt: Date;
};

export type WalletTransactionListResponse = {
  items: WalletTransactionRow[];
  total: number;
  page: number;
  pageSize: number;
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

  async getWalletOverview(): Promise<WalletOverview> {
    const [
      totalAccounts,
      activeAccounts,
      pausedAccounts,
      balanceAgg,
      topUps,
    ] = await Promise.all([
      this.prisma.billingAccount.count(),
      this.prisma.billingAccount.count({ where: { status: "active" } }),
      this.prisma.billingAccount.count({ where: { status: "paused" } }),
      this.prisma.billingPointBalance.aggregate({
        _sum: {
          balance: true,
          lifetimeGranted: true,
          lifetimeSpent: true,
        },
      }),
      this.prisma.billingPaymentTransaction.aggregate({
        where: { kind: "topup", status: "succeeded" },
        _sum: { amountEgp: true },
        _count: { _all: true },
      }),
    ]);

    return {
      totalAccounts,
      activeAccounts,
      pausedAccounts,
      totalPointsOutstanding: balanceAgg._sum.balance ?? 0,
      totalLifetimeGranted: balanceAgg._sum.lifetimeGranted ?? 0,
      totalLifetimeSpent: balanceAgg._sum.lifetimeSpent ?? 0,
      totalTopUpEgp: topUps._sum.amountEgp ?? 0,
      totalTopUpCount: topUps._count._all,
    };
  }

  /**
   * Manual operator wallet top-up — grants points directly to a billing
   * account's wallet and records the before/after balance in the append-only
   * audit log. This is a corrective/manual-correction path (sprint-7 §manual
   * corrections), not a payment: no `BillingPaymentTransaction` is created, so
   * the reconciliation queue never flags it. The ledger row carries the
   * `admin:topup` claim key and the operator reason as a durable trace.
   */
  async topUpWallet(
    id: string,
    points: number,
    reason: string,
    actorUserId: string,
    actorEmail: string,
  ): Promise<{ balance: number; lifetimeGranted: number }> {
    const account = await this.prisma.billingAccount.findUnique({
      where: { id },
      include: {
        pointBalances: { take: 1 },
        ownerUser: { select: { email: true } },
      },
    });
    if (!account) {
      throw new NotFoundException("Billing account not found");
    }

    const balance = account.pointBalances[0];
    if (!balance) {
      throw new NotFoundException("Billing wallet not found");
    }

    const beforeState = { balance: balance.balance, lifetimeGranted: balance.lifetimeGranted };
    const balanceAfter = balance.balance + points;

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.billingPointBalance.update({
        where: { billingAccountId: id },
        data: {
          balance: balanceAfter,
          lifetimeGranted: { increment: points },
        },
      });
      await tx.billingPointLedger.create({
        data: {
          id: randomUUID(),
          billingAccountId: id,
          direction: "credit",
          reason: "topup",
          metric: null,
          points,
          balanceAfter,
          claimKey: `admin:topup:${randomUUID()}`,
          transactionId: null,
          expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        },
      });
      return row;
    });

    await this.auditService.record({
      actorUserId,
      actorEmail,
      action: "billing.wallet_topup",
      targetType: "billing_account",
      targetId: id,
      reason,
      beforeState,
      afterState: {
        balance: updated.balance,
        lifetimeGranted: updated.lifetimeGranted,
      },
    });

    return { balance: updated.balance, lifetimeGranted: updated.lifetimeGranted };
  }

  async listWalletBalances(params: {
    page?: number;
    pageSize?: number;
    search?: string;
    status?: string;
  }): Promise<WalletBalanceListResponse> {
    const page = Math.max(1, params.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 20));
    const search = params.search?.trim();
    const status = params.status?.trim();

    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (search) {
      where.OR = [
        {
          ownerUser: { email: { contains: search, mode: "insensitive" } },
        },
        {
          ownerUser: { fullName: { contains: search, mode: "insensitive" } },
        },
      ];
    }

    const [accounts, total] = await Promise.all([
      this.prisma.billingAccount.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          ownerUser: { select: { email: true, fullName: true } },
          pointBalances: true,
        },
      }),
      this.prisma.billingAccount.count({ where }),
    ]);

    const items: WalletBalanceRow[] = accounts.map((account) => {
      const balance = account.pointBalances[0];
      return {
        accountId: account.id,
        ownerUserId: account.ownerUserId,
        ownerEmail: account.ownerUser?.email ?? null,
        ownerFullName: account.ownerUser?.fullName ?? null,
        status: account.status,
        balance: balance?.balance ?? 0,
        lifetimeGranted: balance?.lifetimeGranted ?? 0,
        lifetimeSpent: balance?.lifetimeSpent ?? 0,
        createdAt: account.createdAt,
      };
    });

    return { items, total, page, pageSize };
  }

  async getWalletLedger(accountId: string): Promise<WalletLedgerRow[]> {
    const rows = await this.prisma.billingPointLedger.findMany({
      where: { billingAccountId: accountId },
      orderBy: { createdAt: "desc" },
      take: 200,
    });

    return rows.map((row) => ({
      id: row.id,
      direction: row.direction,
      reason: row.reason,
      metric: row.metric,
      points: row.points,
      balanceAfter: row.balanceAfter,
      claimKey: row.claimKey,
      expiresAt: row.expiresAt,
      createdAt: row.createdAt,
    }));
  }

  async listWalletTransactions(params: {
    page?: number;
    pageSize?: number;
    accountId?: string;
  }): Promise<WalletTransactionListResponse> {
    const page = Math.max(1, params.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 20));

    const where: Record<string, unknown> = {};
    if (params.accountId) where.billingAccountId = params.accountId;

    const [transactions, total] = await Promise.all([
      this.prisma.billingPaymentTransaction.findMany({
        where,
        orderBy: { occurredAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          billingAccount: {
            include: {
              ownerUser: { select: { email: true, fullName: true } },
            },
          },
        },
      }),
      this.prisma.billingPaymentTransaction.count({ where }),
    ]);

    const items: WalletTransactionRow[] = transactions.map((tx) => ({
      id: tx.id,
      accountId: tx.billingAccountId,
      ownerEmail: tx.billingAccount.ownerUser?.email ?? null,
      ownerFullName: tx.billingAccount.ownerUser?.fullName ?? null,
      provider: tx.provider,
      providerTransactionId: tx.providerTransactionId,
      kind: tx.kind,
      status: tx.status,
      amountEgp: tx.amountEgp,
      currency: tx.currency,
      paymentMode: tx.paymentMode,
      occurredAt: tx.occurredAt,
    }));

    return { items, total, page, pageSize };
  }

  async listAccounts(params: {
    page?: number;
    pageSize?: number;
    search?: string;
    status?: string;
  }): Promise<BillingAccountListResponse> {
    const page = Math.max(1, params.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 20));
    const search = params.search?.trim();
    const status = params.status?.trim();

    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (search) {
      where.OR = [
        {
          ownerUser: {
            email: { contains: search, mode: "insensitive" },
          },
        },
        {
          ownerUser: {
            fullName: { contains: search, mode: "insensitive" },
          },
        },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.billingAccount.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          ownerUser: { select: { email: true, fullName: true } },
        },
      }),
      this.prisma.billingAccount.count({ where }),
    ]);

    return {
      items: items.map((account) => ({
        id: account.id,
        ownerUserId: account.ownerUserId,
        ownerEmail: account.ownerUser?.email ?? null,
        ownerFullName: account.ownerUser?.fullName ?? null,
        status: account.status,
        pausedReason: account.pausedReason,
        pausedAt: account.pausedAt,
        createdAt: account.createdAt,
      })),
      total,
      page,
      pageSize,
    };
  }
}
