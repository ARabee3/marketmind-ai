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
}