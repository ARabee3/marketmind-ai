import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../common/persistence/prisma.service";

const ACTIVE_BUSINESS_STATUS = "active";
const ACTIVE_USER_STATUS = "active";
const ACTIVE_SUBSCRIPTION_STATE = "active";
const TRIALING_SUBSCRIPTION_STATE = "trialing";
const PAST_DUE_SUBSCRIPTION_STATE = "past_due";
const EXPIRED_SUBSCRIPTION_STATE = "expired";

export function resolveLoginMethod(providers: string[]): string {
  return providers.length > 0 ? providers.join(", ") : "password";
}

export interface SubscriptionAggregate {
  amountEgp: number;
  interval: string;
  periodDays: number;
}

export function computeMrrEgp(subs: SubscriptionAggregate[]): number {
  let total = 0;
  for (const sub of subs) {
    if (sub.interval === "monthly") {
      total += sub.amountEgp;
    } else if (sub.interval === "yearly") {
      total += sub.amountEgp / 12;
    } else if (sub.periodDays > 0) {
      total += (sub.amountEgp * 30) / sub.periodDays;
    }
    // A custom-interval price with a non-positive periodDays cannot be
    // annualized; contributing 0 keeps the total finite instead of emitting
    // Infinity/NaN (which JSON-serializes to null and corrupts the summary).
  }
  return Math.round(total);
}

export interface UserRow {
  id: string;
  fullName: string | null;
  email: string;
  isEmailVerified: boolean;
  roles: string[];
  loginMethod: string;
  status: string;
  createdAt: Date;
  lastLoginAt: Date | null;
  businessCount: number;
  activeSessionCount: number;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface UserDetail {
  user: UserRow;
  federatedIdentities: {
    id: string;
    provider: string;
    displayName: string | null;
    email: string | null;
  }[];
  activeSessions: {
    id: string;
    userAgent: string | null;
    ipAddress: string | null;
    expiresAt: Date;
    createdAt: Date;
  }[];
  businesses: {
    id: string;
    displayName: string;
    status: string;
    createdAt: Date;
  }[];
}

export interface RevenueSummary {
  activeBusinesses: number;
  activeSubscriptions: number;
  trialingCount: number;
  mrrEgp: number;
  pastDueSubscriptions: number;
  expiredSubscriptions: number;
  unverifiedUsers: number;
}

export interface SubscriptionRow {
  id: string;
  state: string;
  paidThroughAt: Date | null;
  createdAt: Date;
  ownerEmail: string;
  ownerName: string | null;
  priceDisplayNameEn: string;
  priceDisplayNameAr: string;
  planCode: string;
  amountEgp: number;
  interval: string;
}

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  async getUsers(
    page: number,
    pageSize: number,
    search?: string,
  ): Promise<PaginatedResponse<UserRow>> {
    const where = search
      ? {
          OR: [
            { email: { contains: search, mode: "insensitive" as const } },
            { fullName: { contains: search, mode: "insensitive" as const } },
          ],
        }
      : {};

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: "desc" },
        include: {
          businesses: { select: { id: true } },
          refreshSessions: {
            where: {
              revokedAt: null,
              expiresAt: { gt: new Date() },
            },
            select: { id: true },
          },
          federatedIdentities: {
            select: { provider: true },
          },
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    const items: UserRow[] = users.map((user) => ({
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      isEmailVerified: user.isEmailVerified,
      roles: user.roles,
      loginMethod: resolveLoginMethod(
        user.federatedIdentities.map((identity) => identity.provider),
      ),
      status: user.status,
      createdAt: user.createdAt,
      lastLoginAt: user.lastLoginAt,
      businessCount: user.businesses.length,
      activeSessionCount: user.refreshSessions.length,
    }));

    return { items, total, page, pageSize };
  }

  async getUserById(id: string): Promise<UserDetail | null> {
    const user = await this.prisma.user.findUnique({
      where: { id },
    });

    if (!user) {
      return null;
    }

    const [activeSessions, federatedIdentities, businesses] = await Promise.all(
      [
        this.prisma.refreshSession.findMany({
          where: {
            userId: id,
            revokedAt: null,
            expiresAt: { gt: new Date() },
          },
          select: {
            id: true,
            userAgent: true,
            ipAddress: true,
            expiresAt: true,
            createdAt: true,
          },
          orderBy: { createdAt: "desc" },
        }),
        this.prisma.federatedIdentity.findMany({
          where: { userId: id },
          select: {
            id: true,
            provider: true,
            displayName: true,
            email: true,
          },
        }),
        this.prisma.business.findMany({
          where: { ownerUserId: id },
          select: {
            id: true,
            displayName: true,
            status: true,
            createdAt: true,
          },
          orderBy: { createdAt: "desc" },
        }),
      ],
    );

    return {
      user: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        isEmailVerified: user.isEmailVerified,
        roles: user.roles,
        loginMethod: resolveLoginMethod(
          federatedIdentities.map((identity) => identity.provider),
        ),
        status: user.status,
        createdAt: user.createdAt,
        lastLoginAt: user.lastLoginAt,
        businessCount: businesses.length,
        activeSessionCount: activeSessions.length,
      },
      activeSessions,
      federatedIdentities,
      businesses,
    };
  }

  async getRevenueSummary(): Promise<RevenueSummary> {
    const [
      activeBusinesses,
      activeSubs,
      trialingCount,
      pastDueCount,
      expiredCount,
      unverifiedUsers,
    ] = await Promise.all([
      this.prisma.business.count({
        where: { status: ACTIVE_BUSINESS_STATUS },
      }),
      this.prisma.billingSubscription.findMany({
        where: { state: ACTIVE_SUBSCRIPTION_STATE },
        include: {
          price: {
            select: {
              amountEgp: true,
              interval: true,
              periodDays: true,
            },
          },
        },
      }),
      this.prisma.billingSubscription.count({
        where: { state: TRIALING_SUBSCRIPTION_STATE },
      }),
      this.prisma.billingSubscription.count({
        where: { state: PAST_DUE_SUBSCRIPTION_STATE },
      }),
      this.prisma.billingSubscription.count({
        where: { state: EXPIRED_SUBSCRIPTION_STATE },
      }),
      this.prisma.user.count({
        where: { isEmailVerified: false, status: ACTIVE_USER_STATUS },
      }),
    ]);

    const mrrEgp = computeMrrEgp(
      activeSubs.map((s) => ({
        amountEgp: s.price.amountEgp,
        interval: s.price.interval,
        periodDays: s.price.periodDays,
      })),
    );

    return {
      activeBusinesses,
      activeSubscriptions: activeSubs.length,
      trialingCount,
      mrrEgp,
      pastDueSubscriptions: pastDueCount,
      expiredSubscriptions: expiredCount,
      unverifiedUsers,
    };
  }

  async getSubscriptions(
    page: number,
    pageSize: number,
  ): Promise<PaginatedResponse<SubscriptionRow>> {
    const [subs, total] = await Promise.all([
      this.prisma.billingSubscription.findMany({
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: "desc" },
        include: {
          billingAccount: {
            select: {
              ownerUser: {
                select: { email: true, fullName: true },
              },
            },
          },
          price: {
            select: {
              displayNameEn: true,
              displayNameAr: true,
              planCode: true,
              amountEgp: true,
              interval: true,
            },
          },
        },
      }),
      this.prisma.billingSubscription.count(),
    ]);

    const items: SubscriptionRow[] = subs.map((s) => ({
      id: s.id,
      state: s.state,
      paidThroughAt: s.paidThroughAt,
      createdAt: s.createdAt,
      ownerEmail: s.billingAccount.ownerUser.email,
      ownerName: s.billingAccount.ownerUser.fullName,
      priceDisplayNameEn: s.price.displayNameEn,
      priceDisplayNameAr: s.price.displayNameAr,
      planCode: s.price.planCode,
      amountEgp: s.price.amountEgp,
      interval: s.price.interval,
    }));

    return { items, total, page, pageSize };
  }
}
