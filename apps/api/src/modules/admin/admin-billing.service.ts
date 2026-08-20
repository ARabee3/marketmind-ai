import { randomUUID } from "node:crypto";
import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../common/persistence/prisma.service";
import { AuditService } from "../audit/audit.service";

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

@Injectable()
export class AdminBillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

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
   * Manual operator wallet top-up â€” grants points directly to a billing
   * account's wallet and records the before/after balance in the append-only
   * audit log. This is a corrective/manual-correction path (sprint-7 Â§manual
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
}
