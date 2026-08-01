import { Test, TestingModule } from "@nestjs/testing";
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { ContentService } from "./content.service";
import { ContentCycleRepository } from "./repositories/content-cycle.repository";
import { ContentWeekContextRepository } from "./repositories/content-week-context.repository";
import { StrategyRepository } from "../strategy/strategy.repository";
import type { CreateContentCycleRequest } from "@marketmind/contracts";

const OWNER_ID = "user-1";

const DTO: CreateContentCycleRequest = {
  business_id: "biz-1",
  strategy_id: "strat-1",
  strategy_version: 2,
  strategy_decision_id: "decision-1",
  idempotency_key: "idem-1",
  initial_week_context: {
    week_number: 1,
    week_start_date: "2026-08-01",
    promotion_mode: "none",
    promotion: null,
    must_include: [],
    must_avoid: [],
    approved_asset_ids: [],
    cta_destination: { type: "none", value: null },
  },
};

function makeStrategyRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "strat-1",
    businessId: "biz-1",
    status: "approved",
    currentVersionId: "v-2",
    ownerUserId: OWNER_ID,
    brief: {
      businessProfileVersionId: "prof-1",
      startDate: new Date("2026-08-01T00:00:00.000Z"),
    },
    ...overrides,
  };
}

const CYCLE_ROW = {
  id: "cycle-1",
  contractVersion: "content-v1",
  businessId: "biz-1",
  strategyId: "strat-1",
  strategyVersion: 2,
  strategyDecisionId: "decision-1",
  profileVersionId: "prof-1",
  status: "active",
  currentWeekNumber: 1,
  nextGenerationAt: new Date("2026-08-07T21:00:00.000Z"),
  timezone: "Africa/Cairo",
  pauseReason: null,
  completedAt: null,
  ownerUserId: OWNER_ID,
  idempotencyKey: "idem-1",
  createdAt: new Date("2026-08-01T00:00:00.000Z"),
  updatedAt: new Date("2026-08-01T00:00:00.000Z"),
};

const WEEK_ROW = {
  id: "week-1",
  contractVersion: "content-v1",
  contentCycleId: "cycle-1",
  weekNumber: 1,
  weekStartDate: new Date("2026-08-01T00:00:00.000Z"),
  promotionMode: "none",
  promotion: null,
  mustInclude: [],
  mustAvoid: [],
  approvedAssetIds: [],
  ctaDestination: { type: "none", value: null },
  generationCutoffAt: new Date("2026-08-07T21:00:00.000Z"),
  weeklyClaimId: "claim-1",
  contextSource: "owner_confirmed",
  confirmedByUserId: OWNER_ID,
  confirmedAt: new Date("2026-08-01T00:00:00.000Z"),
  systemDefaultedAt: null,
  createdAt: new Date("2026-08-01T00:00:00.000Z"),
};

type MockedStrategyRepo = jest.Mocked<Partial<StrategyRepository>>;
type MockedCycleRepo = jest.Mocked<Partial<ContentCycleRepository>>;
type MockedWeekRepo = jest.Mocked<Partial<ContentWeekContextRepository>>;

function makeStrategyRepo(
  overrides: Partial<MockedStrategyRepo> = {},
): MockedStrategyRepo {
  return {
    getStrategyByIdAndOwner: jest.fn().mockResolvedValue(makeStrategyRow()),
    getVersionById: jest.fn().mockResolvedValue({
      id: "v-2",
      strategyId: "strat-1",
      version: 2,
    }),
    getActiveConfirmedProfileVersion: jest
      .fn()
      .mockResolvedValue({ id: "prof-1" }),
    ...overrides,
  };
}

function makeCycleRepo(overrides: Partial<MockedCycleRepo> = {}): MockedCycleRepo {
  return {
    createCycle: jest.fn().mockResolvedValue(CYCLE_ROW),
    ...overrides,
  };
}

function makeWeekRepo(overrides: Partial<MockedWeekRepo> = {}): MockedWeekRepo {
  return {
    upsertOwnerContext: jest.fn().mockResolvedValue(WEEK_ROW),
    ...overrides,
  };
}

/** Extracts the `code` from a Nest HttpException response body. */
function errorCode(error: unknown): string | undefined {
  if (error instanceof BadRequestException || error instanceof ConflictException) {
    const response = error.getResponse();
    if (typeof response === "object" && response !== null) {
      return (response as { code?: string }).code;
    }
  }
  return undefined;
}

async function rejectsWithCode(
  promise: Promise<unknown>,
  code: string,
): Promise<void> {
  let caught: unknown;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeDefined();
  expect(errorCode(caught)).toBe(code);
}

describe("ContentService.createCycle", () => {
  let service: ContentService;
  let strategyRepo: MockedStrategyRepo;
  let cycleRepo: MockedCycleRepo;
  let weekRepo: MockedWeekRepo;

  beforeEach(async () => {
    strategyRepo = makeStrategyRepo();
    cycleRepo = makeCycleRepo();
    weekRepo = makeWeekRepo();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContentService,
        { provide: StrategyRepository, useValue: strategyRepo },
        { provide: ContentCycleRepository, useValue: cycleRepo },
        { provide: ContentWeekContextRepository, useValue: weekRepo },
      ],
    }).compile();

    service = module.get<ContentService>(ContentService);
  });

  it("throws NotFound when the Strategy does not exist or is not owned by the caller", async () => {
    (strategyRepo.getStrategyByIdAndOwner as jest.Mock).mockResolvedValue(null);

    await expect(
      service.createCycle(DTO, OWNER_ID),
    ).rejects.toThrow(NotFoundException);
  });

  it("rejects with CONTENT_STRATEGY_NOT_APPROVED when the Strategy is not approved", async () => {
    (strategyRepo.getStrategyByIdAndOwner as jest.Mock).mockResolvedValue(
      makeStrategyRow({ status: "draft" }),
    );

    await rejectsWithCode(service.createCycle(DTO, OWNER_ID), "CONTENT_STRATEGY_NOT_APPROVED");
  });

  it("rejects with CONTENT_STRATEGY_NOT_APPROVED when strategy_version is not the current approved version", async () => {
    (strategyRepo.getVersionById as jest.Mock).mockResolvedValue({
      id: "v-3",
      strategyId: "strat-1",
      version: 3,
    });

    await rejectsWithCode(service.createCycle(DTO, OWNER_ID), "CONTENT_STRATEGY_NOT_APPROVED");
  });

  it("rejects with CONTENT_STRATEGY_NOT_APPROVED when the current version belongs to another Strategy", async () => {
    (strategyRepo.getVersionById as jest.Mock).mockResolvedValue({
      id: "v-2",
      strategyId: "strat-other",
      version: 2,
    });

    await rejectsWithCode(service.createCycle(DTO, OWNER_ID), "CONTENT_STRATEGY_NOT_APPROVED");
  });

  it("rejects with CONTENT_PROFILE_STALE when the approved profile is no longer the active confirmed one", async () => {
    (strategyRepo.getActiveConfirmedProfileVersion as jest.Mock).mockResolvedValue({
      id: "prof-2",
    });

    await rejectsWithCode(service.createCycle(DTO, OWNER_ID), "CONTENT_PROFILE_STALE");
  });

  it("creates the cycle and initial owner-confirmed week context for week 1", async () => {
    const result = await service.createCycle(DTO, OWNER_ID);

    expect(result.content_cycle.id).toBe("cycle-1");
    expect(result.initial_week_context.week_number).toBe(1);
    expect(result.initial_week_context.week_start_date).toBe("2026-08-01");
    expect(result.initial_week_context.context_source).toBe("owner_confirmed");

    expect(cycleRepo.createCycle).toHaveBeenCalledWith(
      expect.objectContaining({
        businessId: "biz-1",
        strategyId: "strat-1",
        strategyVersion: 2,
        strategyDecisionId: "decision-1",
        profileVersionId: "prof-1",
        idempotencyKey: "idem-1",
      }),
      OWNER_ID,
    );

    // Week 1 cutoff = start of week 2 in Africa/Cairo (end of the current
    // Strategy week). The Cairo date of the persisted cutoff must be
    // 2026-08-08 (strategy start + 7 days).
    const cutoff = (cycleRepo.createCycle as jest.Mock).mock.calls[0][0]
      .nextGenerationAt as Date;
    expect(cutoff).toBeInstanceOf(Date);
    const cairoDate = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Africa/Cairo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(cutoff);
    expect(cairoDate).toBe("2026-08-08");

    // The initial context is persisted with the server-authoritative week
    // number/start date even if the client sent different values.
    expect(weekRepo.upsertOwnerContext).toHaveBeenCalledWith(
      "cycle-1",
      expect.objectContaining({
        week_number: 1,
        week_start_date: "2026-08-01",
      }),
      OWNER_ID,
    );
  });

  it("returns the same cycle on idempotent replay (repository returns the original row)", async () => {
    const replayCycle = { ...CYCLE_ROW, id: "cycle-original" };
    (cycleRepo.createCycle as jest.Mock).mockResolvedValue(replayCycle);

    const result = await service.createCycle(DTO, OWNER_ID);

    expect(result.content_cycle.id).toBe("cycle-original");
    expect(cycleRepo.createCycle).toHaveBeenCalledTimes(1);
  });
});
