import { Injectable } from "@nestjs/common";
import { AuditLog, Prisma } from "@prisma/client";
import { PrismaService } from "../../common/persistence/prisma.service";

export interface AuditRecordInput {
  actorUserId: string;
  actorEmail?: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  reason?: string | null;
  beforeState?: unknown;
  afterState?: unknown;
}

export interface AuditQueryFilters {
  actor?: string;
  action?: string;
  from?: string;
  to?: string;
  page: number;
  pageSize: number;
}

export interface PaginatedAuditLogs {
  items: AuditLog[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Append-only audit trail.
 *
 * `record()` is the ONLY write path; there is intentionally no update or
 * delete service method and no endpoint mutates existing rows. Immutability
 * is enforced by convention (no mutation surface) and asserted by tests.
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  record(input: AuditRecordInput): Promise<AuditLog> {
    return this.prisma.auditLog.create({
      data: {
        actorUserId: input.actorUserId,
        actorEmail: input.actorEmail ?? null,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId ?? null,
        reason: input.reason ?? null,
        beforeState:
          input.beforeState === undefined
            ? undefined
            : (input.beforeState as Prisma.InputJsonValue),
        afterState:
          input.afterState === undefined
            ? undefined
            : (input.afterState as Prisma.InputJsonValue),
      },
    });
  }

  async list(filters: AuditQueryFilters): Promise<PaginatedAuditLogs> {
    const where: Prisma.AuditLogWhereInput = {
      ...(filters.actor ? { actorUserId: filters.actor } : {}),
      ...(filters.action ? { action: filters.action } : {}),
      ...(filters.from || filters.to
        ? {
            createdAt: {
              ...(filters.from ? { gte: new Date(filters.from) } : {}),
              ...(filters.to ? { lte: new Date(filters.to) } : {}),
            },
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        skip: (filters.page - 1) * filters.pageSize,
        take: filters.pageSize,
        orderBy: { createdAt: "desc" },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return { items, total, page: filters.page, pageSize: filters.pageSize };
  }
}