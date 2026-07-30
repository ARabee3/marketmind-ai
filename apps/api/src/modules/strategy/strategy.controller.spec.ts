import { Reflector } from "@nestjs/core";
import { Test, TestingModule } from "@nestjs/testing";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { RbacService } from "../rbac/rbac.service";
import { RedisService } from "../redis/redis.service";
import { Role } from "@prisma/client";
import { StrategyController } from "./strategy.controller";
import { StrategyService } from "./strategy.service";

type MockedService = jest.Mocked<
  Pick<
    StrategyService,
    | "createStrategy"
    | "upsertBrief"
    | "startGeneration"
    | "getStrategy"
    | "getStrategyVersion"
    | "getRetrievalPack"
    | "getProgressEvents"
    | "handleDecision"
    | "retryGeneration"
  >
>;

describe("StrategyController", () => {
  let controller: StrategyController;
  let service: MockedService;

  const mockUser = { id: "user-1", email: "owner@test.com", roles: [Role.OWNER] };
  const mockReq = { user: mockUser } as never;

  beforeEach(async () => {
    service = {
      createStrategy: jest.fn(),
      upsertBrief: jest.fn(),
      startGeneration: jest.fn(),
      getStrategy: jest.fn(),
      getStrategyVersion: jest.fn(),
      getRetrievalPack: jest.fn(),
      getProgressEvents: jest.fn(),
      handleDecision: jest.fn(),
      retryGeneration: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [StrategyController],
      providers: [
        { provide: StrategyService, useValue: service },
        { provide: RbacService, useValue: { hasAllPermissions: jest.fn().mockReturnValue(true) } },
        { provide: RedisService, useValue: { getClient: jest.fn().mockReturnValue({ pipeline: jest.fn().mockReturnValue({ incr: jest.fn().mockReturnThis(), expire: jest.fn().mockReturnThis(), exec: jest.fn().mockResolvedValue([[null, 1], [null, 1]]) }) }) } },
        Reflector,
      ],
    }).compile();

    controller = module.get<StrategyController>(StrategyController);
  });

  it("should be defined", () => {
    expect(controller).toBeDefined();
  });

  // ── RBAC ────────────────────────────────────────────────────────────
  // The @UseGuards(JwtAuthGuard, PermissionsGuard) + @Permissions decorator
  // on the controller class are verified by reading the source and by the
  // existing permissions.guard.spec.ts. Guards do not fire when calling
  // controller methods directly in a unit test; RBAC enforcement is covered
  // end-to-end. Here we verify the controller delegates correctly to the
  // service with the owner's id from the JWT payload.

  describe("delegation", () => {
    it("delegates createStrategy to the service with the owner id", async () => {
      service.createStrategy.mockResolvedValue({ id: "strat-1" } as never);

      await controller.createStrategy(mockReq, { businessProfileVersionId: "profile-1" });

      expect(service.createStrategy).toHaveBeenCalledWith(
        { businessProfileVersionId: "profile-1" },
        mockUser.id,
      );
    });

    it("delegates progress reads to the service with the owner id", async () => {
      service.getProgressEvents.mockResolvedValue([] as never);

      await controller.getProgressEvents("strat-1", mockReq);

      expect(service.getProgressEvents).toHaveBeenCalledWith("strat-1", mockUser.id);
    });
  });

  // ── Ownership enforcement ───────────────────────────────────────────

  describe("getStrategy — ownership", () => {
    it("propagates NotFoundException when strategy does not belong to owner", async () => {
      service.getStrategy.mockRejectedValue(new NotFoundException());

      await expect(controller.getStrategy("strat-1", mockReq)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ── generate — idempotency ──────────────────────────────────────────

  describe("generateStrategy — idempotency", () => {
    it("propagates BadRequestException when already generating", async () => {
      service.startGeneration.mockRejectedValue(
        new BadRequestException("Generation is already in progress"),
      );
      await expect(controller.generateStrategy("strat-1", mockReq)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ── decisions ───────────────────────────────────────────────────────

  describe("ownerDecision", () => {
    it("calls service with the correct dto", async () => {
      const dto = { versionId: "v-1", action: "approve" as const };
      service.handleDecision.mockResolvedValue({ decision: { id: "decision-1" } } as never);

      await controller.ownerDecision("strat-1", mockReq, dto);

      expect(service.handleDecision).toHaveBeenCalledWith("strat-1", mockUser.id, dto);
    });
  });

  // ── retry ───────────────────────────────────────────────────────────

  describe("retryGeneration — bound check", () => {
    it("propagates BadRequestException when max retries exhausted", async () => {
      service.retryGeneration.mockRejectedValue(
        new BadRequestException("Maximum retry limit of 3 has been reached"),
      );
      await expect(controller.retryGeneration("strat-1", mockReq)).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
