import { Reflector } from "@nestjs/core";
import { Test, TestingModule } from "@nestjs/testing";
import { BadRequestException, NotFoundException, ValidationPipe } from "@nestjs/common";
import { RbacService } from "../rbac/rbac.service";
import { RedisService } from "../redis/redis.service";
import { Role } from "@prisma/client";
import {
  ContentCycleController,
  ContentPackController,
} from "./content.controller";
import { ContentService } from "./content.service";
import { CreateContentCycleDto } from "./dto/create-content-cycle.dto";
import { ContentDecisionDto } from "./dto/content-decision.dto";

type MockedService = jest.Mocked<
  Pick<
    ContentService,
    | "createCycle"
    | "getCycle"
    | "pauseCycle"
    | "resumeCycle"
    | "listWeeks"
    | "upsertWeekContext"
    | "generateWeek"
    | "getPack"
    | "getPackProgress"
    | "retryPack"
    | "getItemVersions"
    | "decide"
    | "bulkDecide"
  >
>;

describe("ContentCycleController", () => {
  let controller: ContentCycleController;
  let service: MockedService;

  const mockUser = { id: "user-1", email: "owner@test.com", roles: [Role.OWNER] };
  const mockReq = { user: mockUser } as never;

  beforeEach(async () => {
    service = {
      createCycle: jest.fn(),
      getCycle: jest.fn(),
      pauseCycle: jest.fn(),
      resumeCycle: jest.fn(),
      listWeeks: jest.fn(),
      upsertWeekContext: jest.fn(),
      generateWeek: jest.fn(),
      getPack: jest.fn(),
      getPackProgress: jest.fn(),
      retryPack: jest.fn(),
      getItemVersions: jest.fn(),
      decide: jest.fn(),
      bulkDecide: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ContentCycleController],
      providers: [
        { provide: ContentService, useValue: service },
        { provide: RbacService, useValue: { hasAllPermissions: jest.fn().mockReturnValue(true) } },
        { provide: RedisService, useValue: { getClient: jest.fn().mockReturnValue({ pipeline: jest.fn().mockReturnValue({ incr: jest.fn().mockReturnThis(), expire: jest.fn().mockReturnThis(), exec: jest.fn().mockResolvedValue([[null, 1], [null, 1]]) }) }) } },
        Reflector,
      ],
    }).compile();

    controller = module.get<ContentCycleController>(ContentCycleController);
  });

  it("should be defined", () => {
    expect(controller).toBeDefined();
  });

  describe("delegation", () => {
    it("delegates createCycle to the service with the owner id", async () => {
      const dto = {
        business_id: "b-1",
        strategy_id: "s-1",
        strategy_version: 3,
        strategy_decision_id: "d-1",
        idempotency_key: "key-1",
        initial_week_context: {},
      } as never;
      service.createCycle.mockResolvedValue({ content_cycle: { id: "c-1" } } as never);

      await controller.createCycle(mockReq, dto);

      expect(service.createCycle).toHaveBeenCalledWith(dto, mockUser.id);
    });

    it("delegates getCycle to the service with the owner id", async () => {
      service.getCycle.mockResolvedValue({ id: "c-1" } as never);

      await controller.getCycle("c-1", mockReq);

      expect(service.getCycle).toHaveBeenCalledWith("c-1", mockUser.id);
    });

    it("delegates pauseCycle with the reason", async () => {
      service.pauseCycle.mockResolvedValue({ id: "c-1" } as never);

      await controller.pauseCycle("c-1", mockReq, { reason: "owner holiday" });

      expect(service.pauseCycle).toHaveBeenCalledWith(
        "c-1",
        mockUser.id,
        "owner holiday",
      );
    });

    it("delegates pauseCycle with a null reason when absent", async () => {
      service.pauseCycle.mockResolvedValue({ id: "c-1" } as never);

      await controller.pauseCycle("c-1", mockReq, {});

      expect(service.pauseCycle).toHaveBeenCalledWith("c-1", mockUser.id, null);
    });

    it("delegates resumeCycle to the service with the owner id", async () => {
      service.resumeCycle.mockResolvedValue({ id: "c-1" } as never);

      await controller.resumeCycle("c-1", mockReq);

      expect(service.resumeCycle).toHaveBeenCalledWith("c-1", mockUser.id);
    });

    it("delegates listWeeks to the service with the owner id", async () => {
      service.listWeeks.mockResolvedValue({ weeks: [] } as never);

      await controller.listWeeks("c-1", mockReq);

      expect(service.listWeeks).toHaveBeenCalledWith("c-1", mockUser.id);
    });

    it("delegates upsertWeekContext with the parsed week number", async () => {
      const dto = {} as never;
      service.upsertWeekContext.mockResolvedValue({ id: "w-1" } as never);

      await controller.upsertWeekContext("c-1", 3, mockReq, dto);

      expect(service.upsertWeekContext).toHaveBeenCalledWith(
        "c-1",
        3,
        dto,
        mockUser.id,
      );
    });

    it("delegates generateWeek with the parsed week number", async () => {
      const dto = {} as never;
      service.generateWeek.mockResolvedValue({ content_pack: { id: "p-1" } } as never);

      await controller.generateWeek("c-1", 2, mockReq, dto);

      expect(service.generateWeek).toHaveBeenCalledWith("c-1", 2, dto, mockUser.id);
    });
  });

  describe("getCycle — ownership", () => {
    it("propagates NotFoundException when cycle does not belong to owner", async () => {
      service.getCycle.mockRejectedValue(new NotFoundException());

      await expect(controller.getCycle("c-1", mockReq)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});

describe("ContentPackController", () => {
  let controller: ContentPackController;
  let service: MockedService;

  const mockUser = { id: "user-1", email: "owner@test.com", roles: [Role.OWNER] };
  const mockReq = { user: mockUser } as never;

  beforeEach(async () => {
    service = {
      createCycle: jest.fn(),
      getCycle: jest.fn(),
      pauseCycle: jest.fn(),
      resumeCycle: jest.fn(),
      listWeeks: jest.fn(),
      upsertWeekContext: jest.fn(),
      generateWeek: jest.fn(),
      getPack: jest.fn(),
      getPackProgress: jest.fn(),
      retryPack: jest.fn(),
      getItemVersions: jest.fn(),
      decide: jest.fn(),
      bulkDecide: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ContentPackController],
      providers: [
        { provide: ContentService, useValue: service },
        { provide: RbacService, useValue: { hasAllPermissions: jest.fn().mockReturnValue(true) } },
        { provide: RedisService, useValue: { getClient: jest.fn().mockReturnValue({ pipeline: jest.fn().mockReturnValue({ incr: jest.fn().mockReturnThis(), expire: jest.fn().mockReturnThis(), exec: jest.fn().mockResolvedValue([[null, 1], [null, 1]]) }) }) } },
        Reflector,
      ],
    }).compile();

    controller = module.get<ContentPackController>(ContentPackController);
  });

  it("should be defined", () => {
    expect(controller).toBeDefined();
  });

  describe("delegation", () => {
    it("delegates getPack to the service with the owner id", async () => {
      service.getPack.mockResolvedValue({ id: "p-1" } as never);

      await controller.getPack("p-1", mockReq);

      expect(service.getPack).toHaveBeenCalledWith("p-1", mockUser.id);
    });

    it("delegates getPackProgress to the service with the owner id", async () => {
      service.getPackProgress.mockResolvedValue([] as never);

      await controller.getPackProgress("p-1", mockReq);

      expect(service.getPackProgress).toHaveBeenCalledWith("p-1", mockUser.id);
    });

    it("delegates retryPack to the service with the owner id", async () => {
      service.retryPack.mockResolvedValue({ content_pack: { id: "p-1" } } as never);

      await controller.retryPack("p-1", mockReq);

      expect(service.retryPack).toHaveBeenCalledWith("p-1", mockUser.id);
    });

    it("delegates getItemVersions with both ids and the owner id", async () => {
      service.getItemVersions.mockResolvedValue([] as never);

      await controller.getItemVersions("p-1", "i-1", mockReq);

      expect(service.getItemVersions).toHaveBeenCalledWith(
        "p-1",
        "i-1",
        mockUser.id,
      );
    });

    it("delegates decide with the dto and the owner id", async () => {
      const dto = {
        content_item_id: "i-1",
        content_item_version_id: "v-1",
        content_item_version_checksum: "abc",
        decision: "approved",
        revision_notes: null,
        idempotency_key: "k-1",
      } as ContentDecisionDto;
      service.decide.mockResolvedValue({ decision: { id: "dec-1" } } as never);

      await controller.decide("p-1", "i-1", mockReq, dto);

      expect(service.decide).toHaveBeenCalledWith("p-1", "i-1", dto, mockUser.id);
    });

    it("delegates bulkDecide with the decisions array and the owner id", async () => {
      const decisions = [
        { content_item_id: "i-1", idempotency_key: "k-1" },
      ] as never;
      service.bulkDecide.mockResolvedValue([] as never);

      await controller.bulkDecide("p-1", mockReq, { decisions });

      expect(service.bulkDecide).toHaveBeenCalledWith("p-1", decisions, mockUser.id);
    });
  });

  describe("getPack — ownership", () => {
    it("propagates NotFoundException when pack does not belong to owner", async () => {
      service.getPack.mockRejectedValue(new NotFoundException());

      await expect(controller.getPack("p-1", mockReq)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});

describe("Content controller ValidationPipe", () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true });

  it("rejects non-whitelisted fields on CreateContentCycleDto", async () => {
    const dto = {
      business_id: "b-1",
      strategy_id: "s-1",
      strategy_version: 1,
      strategy_decision_id: "d-1",
      idempotency_key: "k-1",
      initial_week_context: {},
      hacked_field: "nope",
    };

    await expect(
      pipe.transform(dto, { metatype: CreateContentCycleDto, type: "body" }),
    ).rejects.toThrow(BadRequestException);
  });

  it("rejects invalid decision values on ContentDecisionDto", async () => {
    const dto = {
      content_item_id: "i-1",
      content_item_version_id: "v-1",
      content_item_version_checksum: "abc",
      decision: "approve_now",
      revision_notes: null,
      idempotency_key: "k-1",
    };

    await expect(
      pipe.transform(dto, { metatype: ContentDecisionDto, type: "body" }),
    ).rejects.toThrow(BadRequestException);
  });
});
