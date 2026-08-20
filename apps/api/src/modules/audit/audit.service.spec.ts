import { Test, TestingModule } from "@nestjs/testing";
import { AuditService } from "./audit.service";
import { PrismaService } from "../../common/persistence/prisma.service";

describe("AuditService", () => {
  let service: AuditService;
  let prisma: {
    auditLog: {
      create: jest.Mock;
    };
  };

  beforeEach(async () => {
    prisma = {
      auditLog: {
        create: jest.fn().mockResolvedValue({ id: "audit-1" }),
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
});