import { Test, TestingModule } from "@nestjs/testing";
import { AuditService } from "./audit.service";
import { PrismaService } from "../../common/persistence/prisma.service";

describe("AuditService", () => {
  let service: AuditService;
  let prisma: {
    auditLog: {
      create: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
    };
  };

  beforeEach(async () => {
    prisma = {
      auditLog: {
        create: jest.fn().mockResolvedValue({ id: "audit-1" }),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [AuditService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<AuditService>(AuditService);
  });

  describe("record", () => {
    it("creates an audit row with the full input", async () => {
      await service.record({
        actorUserId: "actor-1",
        actorEmail: "actor@test.local",
        action: "user.suspend",
        targetType: "user",
        targetId: "user-1",
        reason: "fraud review",
        beforeState: { status: "active" },
        afterState: { status: "suspended" },
      });

      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: {
          actorUserId: "actor-1",
          actorEmail: "actor@test.local",
          action: "user.suspend",
          targetType: "user",
          targetId: "user-1",
          reason: "fraud review",
          beforeState: { status: "active" },
          afterState: { status: "suspended" },
        },
      });
    });

    it("omits optional fields when not provided", async () => {
      await service.record({
        actorUserId: "actor-1",
        action: "user.role_change",
        targetType: "user",
      });

      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: {
          actorUserId: "actor-1",
          actorEmail: null,
          action: "user.role_change",
          targetType: "user",
          targetId: null,
          reason: null,
          beforeState: undefined,
          afterState: undefined,
        },
      });
    });
  });

  describe("list", () => {
    it("returns paginated results and builds filters", async () => {
      prisma.auditLog.findMany.mockResolvedValue([{ id: "audit-1" }]);
      prisma.auditLog.count.mockResolvedValue(1);

      const result = await service.list({
        actor: "actor-1",
        action: "user.suspend",
        from: "2026-01-01T00:00:00.000Z",
        to: "2026-01-02T00:00:00.000Z",
        page: 2,
        pageSize: 10,
      });

      expect(result).toEqual({ items: [{ id: "audit-1" }], total: 1, page: 2, pageSize: 10 });
      expect(prisma.auditLog.findMany).toHaveBeenCalledWith({
        where: {
          actorUserId: "actor-1",
          action: "user.suspend",
          createdAt: {
            gte: new Date("2026-01-01T00:00:00.000Z"),
            lte: new Date("2026-01-02T00:00:00.000Z"),
          },
        },
        skip: 10,
        take: 10,
        orderBy: { createdAt: "desc" },
      });
      expect(prisma.auditLog.count).toHaveBeenCalled();
    });

    it("returns an empty page when nothing matches", async () => {
      const result = await service.list({ page: 1, pageSize: 20 });

      expect(result.total).toBe(0);
      expect(result.items).toEqual([]);
      expect(prisma.auditLog.findMany).toHaveBeenCalledWith({
        where: {},
        skip: 0,
        take: 20,
        orderBy: { createdAt: "desc" },
      });
    });
  });
});