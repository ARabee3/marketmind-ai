import { Test, TestingModule } from "@nestjs/testing";
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { getQueueToken } from "@nestjs/bullmq";
import { ContentService } from "./content.service";
import { ContentCycleRepository } from "./repositories/content-cycle.repository";
import { ContentWeekContextRepository } from "./repositories/content-week-context.repository";
import { ContentPackRepository } from "./repositories/content-pack.repository";
import { StrategyRepository } from "../strategy/strategy.repository";
import type {
  CreateContentCycleRequest,
  GenerateContentPackRequest,
  UpsertContentWeekContextRequest,
} from "@marketmind/contracts";

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

const SYSTEM_DEFAULTED_WEEK_ROW = {
  id: "week-defaulted",
  contractVersion: "content-v1",
  contentCycleId: "cycle-1",
  weekNumber: 3,
  weekStartDate: new Date("2026-08-15T00:00:00.000Z"),
  promotionMode: "none",
  promotion: null,
  mustInclude: [],
  mustAvoid: [],
  approvedAssetIds: [],
  ctaDestination: { type: "none", value: null },
  generationCutoffAt: new Date("2026-08-21T21:00:00.000Z"),
  weeklyClaimId: "claim-defaulted",
  contextSource: "system_defaulted",
  confirmedByUserId: null,
  confirmedAt: null,
  systemDefaultedAt: new Date("2026-08-15T00:00:00.000Z"),
  createdAt: new Date("2026-08-15T00:00:00.000Z"),
};

type MockedStrategyRepo = jest.Mocked<Partial<StrategyRepository>>;
type MockedCycleRepo = jest.Mocked<Partial<ContentCycleRepository>>;
type MockedWeekRepo = jest.Mocked<Partial<ContentWeekContextRepository>>;
type MockedPackRepo = jest.Mocked<Partial<ContentPackRepository>>;

const PACK_ROW = {
  id: "pack-1",
  contractVersion: "content-v1",
  contentCycleId: "cycle-1",
  weeklyClaimId: "claim-pack-1",
  weekNumber: 1,
  businessId: "biz-1",
  strategyId: "strat-1",
  strategyVersion: 2,
  strategyDecisionId: "decision-1",
  profileVersionId: "prof-1",
  weekContextId: "week-1",
  status: "queued",
  retryEligible: true,
  itemIds: [],
  createdAt: new Date("2026-08-01T00:00:00.000Z"),
  updatedAt: new Date("2026-08-01T00:00:00.000Z"),
};

const GENERATE_DTO: GenerateContentPackRequest = {
  content_cycle_id: "cycle-1",
  week_number: 1,
  idempotency_key: "gen-idem-1",
};

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
    getCycleByIdAndOwner: jest.fn().mockResolvedValue(CYCLE_ROW),
    getCycleById: jest.fn().mockResolvedValue(CYCLE_ROW),
    ...overrides,
  };
}

function makeWeekRepo(overrides: Partial<MockedWeekRepo> = {}): MockedWeekRepo {
  return {
    upsertOwnerContext: jest.fn().mockResolvedValue(WEEK_ROW),
    listWeeks: jest.fn().mockResolvedValue([]),
    createSafeDefaultContext: jest.fn().mockResolvedValue(SYSTEM_DEFAULTED_WEEK_ROW),
    ...overrides,
  };
}

function makePackRepo(overrides: Partial<MockedPackRepo> = {}): MockedPackRepo {
  return {
    claimQueuedPack: jest
      .fn()
      .mockResolvedValue({ pack: PACK_ROW, created: true }),
    appendProgressEvent: jest.fn().mockResolvedValue({
      id: 1n,
      contentPackId: "pack-1",
      seq: 1,
      stage: "queued",
      status: "started",
      messageKey: "content.queued",
      messageText: "Generation job queued.",
      payload: {},
      createdAt: new Date("2026-08-01T00:00:00.000Z"),
    }),
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
        { provide: ContentPackRepository, useValue: makePackRepo() },
        { provide: getQueueToken("content-generation"), useValue: { add: jest.fn() } },
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

describe("ContentService.upsertWeekContext", () => {
  let service: ContentService;
  let cycleRepo: MockedCycleRepo;
  let weekRepo: MockedWeekRepo;

  beforeEach(async () => {
    cycleRepo = makeCycleRepo();
    weekRepo = makeWeekRepo();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContentService,
        { provide: StrategyRepository, useValue: makeStrategyRepo() },
        { provide: ContentCycleRepository, useValue: cycleRepo },
        { provide: ContentWeekContextRepository, useValue: weekRepo },
        { provide: ContentPackRepository, useValue: makePackRepo() },
        { provide: getQueueToken("content-generation"), useValue: { add: jest.fn() } },
      ],
    }).compile();

    service = module.get<ContentService>(ContentService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("throws NotFound when the cycle does not exist or is not owned by the caller", async () => {
    (cycleRepo.getCycleByIdAndOwner as jest.Mock).mockResolvedValue(null);

    await expect(
      service.upsertWeekContext("cycle-1", 1, DTO.initial_week_context, OWNER_ID),
    ).rejects.toThrow(NotFoundException);
  });

  it("rejects with CONTENT_CYCLE_PAUSED when the cycle is paused", async () => {
    (cycleRepo.getCycleByIdAndOwner as jest.Mock).mockResolvedValue({
      ...CYCLE_ROW,
      status: "paused",
    });

    await rejectsWithCode(
      service.upsertWeekContext("cycle-1", 1, DTO.initial_week_context, OWNER_ID),
      "CONTENT_CYCLE_PAUSED",
    );
  });

  it("rejects with CONTENT_CYCLE_COMPLETED when the cycle is completed", async () => {
    (cycleRepo.getCycleByIdAndOwner as jest.Mock).mockResolvedValue({
      ...CYCLE_ROW,
      status: "completed",
    });

    await rejectsWithCode(
      service.upsertWeekContext("cycle-1", 1, DTO.initial_week_context, OWNER_ID),
      "CONTENT_CYCLE_COMPLETED",
    );
  });

  it("rejects with CONTENT_WEEK_OUT_OF_RANGE for weeks outside 1-12", async () => {
    await rejectsWithCode(
      service.upsertWeekContext("cycle-1", 0, DTO.initial_week_context, OWNER_ID),
      "CONTENT_WEEK_OUT_OF_RANGE",
    );
    await rejectsWithCode(
      service.upsertWeekContext("cycle-1", 13, DTO.initial_week_context, OWNER_ID),
      "CONTENT_WEEK_OUT_OF_RANGE",
    );
  });

  it("persists owner-confirmed context before the cutoff, server-authoritative week fields", async () => {
    // Week 1 cutoff = start of week 2 in Cairo = 2026-08-07T21:00:00Z.
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-08-01T00:00:00.000Z"));

    const result = await service.upsertWeekContext(
      "cycle-1",
      1,
      { ...DTO.initial_week_context, week_number: 4, week_start_date: "2026-01-01" },
      OWNER_ID,
    );

    expect(result.week_number).toBe(1);
    expect(result.week_start_date).toBe("2026-08-01");
    expect(result.context_source).toBe("owner_confirmed");

    // The server is authoritative for week number and start date; the client's
    // values are ignored.
    expect(weekRepo.upsertOwnerContext).toHaveBeenCalledWith(
      "cycle-1",
      expect.objectContaining({
        week_number: 1,
        week_start_date: "2026-08-01",
      }),
      OWNER_ID,
    );
  });

  it("rejects with CONTENT_WEEK_ALREADY_CLAIMED after the generation cutoff has passed", async () => {
    // Week 1 cutoff = 2026-08-07T21:00:00Z; run after it.
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-08-08T00:00:00.000Z"));

    await rejectsWithCode(
      service.upsertWeekContext("cycle-1", 1, DTO.initial_week_context, OWNER_ID),
      "CONTENT_WEEK_ALREADY_CLAIMED",
    );
  });

  it("rejects with CONTENT_WEEK_ALREADY_CLAIMED when a system safe default already claimed the week", async () => {
    (weekRepo.listWeeks as jest.Mock).mockResolvedValue([
      { ...SYSTEM_DEFAULTED_WEEK_ROW, weekNumber: 1 },
    ]);

    await rejectsWithCode(
      service.upsertWeekContext("cycle-1", 1, DTO.initial_week_context, OWNER_ID),
      "CONTENT_WEEK_ALREADY_CLAIMED",
    );
  });
});

describe("ContentService.safeDefaultWeekContext", () => {
  let service: ContentService;
  let cycleRepo: MockedCycleRepo;
  let weekRepo: MockedWeekRepo;

  beforeEach(async () => {
    cycleRepo = makeCycleRepo();
    weekRepo = makeWeekRepo();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContentService,
        { provide: StrategyRepository, useValue: makeStrategyRepo() },
        { provide: ContentCycleRepository, useValue: cycleRepo },
        { provide: ContentWeekContextRepository, useValue: weekRepo },
        { provide: ContentPackRepository, useValue: makePackRepo() },
        { provide: getQueueToken("content-generation"), useValue: { add: jest.fn() } },
      ],
    }).compile();

    service = module.get<ContentService>(ContentService);
  });

  it("throws NotFound when the cycle does not exist", async () => {
    (cycleRepo.getCycleById as jest.Mock).mockResolvedValue(null);

    await expect(
      service.safeDefaultWeekContext("cycle-1", 3),
    ).rejects.toThrow(NotFoundException);
  });

  it("rejects with CONTENT_WEEK_OUT_OF_RANGE for weeks outside 1-12", async () => {
    await rejectsWithCode(
      service.safeDefaultWeekContext("cycle-1", 0),
      "CONTENT_WEEK_OUT_OF_RANGE",
    );
    await rejectsWithCode(
      service.safeDefaultWeekContext("cycle-1", 13),
      "CONTENT_WEEK_OUT_OF_RANGE",
    );
  });

  it("persists a promotion-free safe default with cycle-derived dates", async () => {
    const result = await service.safeDefaultWeekContext("cycle-1", 3);

    // Week 3 starts 2026-08-15 (week 2 start + 7) and its cutoff is the start
    // of week 4 (2026-08-22) in Africa/Cairo.
    expect(weekRepo.createSafeDefaultContext).toHaveBeenCalledWith(
      "cycle-1",
      3,
      expect.objectContaining({
        weekStartDate: new Date("2026-08-14T21:00:00.000Z"),
        cutoffAt: new Date("2026-08-21T21:00:00.000Z"),
      }),
    );

    expect(result.promotion_mode).toBe("none");
    expect(result.context_source).toBe("system_defaulted");
    expect(result.confirmed_by_user_id).toBeNull();
    expect(result.system_defaulted_at).toBe("2026-08-15T00:00:00.000Z");
  });
});

describe("ContentService.generateWeek", () => {
  let service: ContentService;
  let cycleRepo: MockedCycleRepo;
  let weekRepo: MockedWeekRepo;
  let packRepo: MockedPackRepo;
  let queue: { add: jest.Mock };

  beforeEach(async () => {
    cycleRepo = makeCycleRepo();
    weekRepo = makeWeekRepo();
    packRepo = makePackRepo();
    queue = { add: jest.fn().mockResolvedValue({ id: "job-1" }) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContentService,
        { provide: StrategyRepository, useValue: makeStrategyRepo() },
        { provide: ContentCycleRepository, useValue: cycleRepo },
        { provide: ContentWeekContextRepository, useValue: weekRepo },
        { provide: ContentPackRepository, useValue: packRepo },
        { provide: getQueueToken("content-generation"), useValue: queue },
      ],
    }).compile();

    service = module.get<ContentService>(ContentService);
  });

  it("throws NotFound when the cycle does not exist or is not owned by the caller", async () => {
    (cycleRepo.getCycleByIdAndOwner as jest.Mock).mockResolvedValue(null);

    await expect(
      service.generateWeek("cycle-1", 1, GENERATE_DTO, OWNER_ID),
    ).rejects.toThrow(NotFoundException);
  });

  it("rejects with CONTENT_CYCLE_PAUSED when the cycle is paused", async () => {
    (cycleRepo.getCycleByIdAndOwner as jest.Mock).mockResolvedValue({
      ...CYCLE_ROW,
      status: "paused",
    });

    await rejectsWithCode(
      service.generateWeek("cycle-1", 1, GENERATE_DTO, OWNER_ID),
      "CONTENT_CYCLE_PAUSED",
    );
  });

  it("rejects with CONTENT_CYCLE_COMPLETED when the cycle is completed", async () => {
    (cycleRepo.getCycleByIdAndOwner as jest.Mock).mockResolvedValue({
      ...CYCLE_ROW,
      status: "completed",
    });

    await rejectsWithCode(
      service.generateWeek("cycle-1", 1, GENERATE_DTO, OWNER_ID),
      "CONTENT_CYCLE_COMPLETED",
    );
  });

  it("rejects with CONTENT_WEEK_OUT_OF_RANGE for weeks outside 1-12", async () => {
    await rejectsWithCode(
      service.generateWeek("cycle-1", 0, GENERATE_DTO, OWNER_ID),
      "CONTENT_WEEK_OUT_OF_RANGE",
    );
    await rejectsWithCode(
      service.generateWeek("cycle-1", 13, GENERATE_DTO, OWNER_ID),
      "CONTENT_WEEK_OUT_OF_RANGE",
    );
  });

  it("claims the week, enqueues a generation job, and returns the queued pack", async () => {
    (weekRepo.listWeeks as jest.Mock).mockResolvedValue([WEEK_ROW]);

    const result = await service.generateWeek("cycle-1", 1, GENERATE_DTO, OWNER_ID);

    expect(result.status).toBe("queued");
    expect(result.correlation_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(result.content_pack.id).toBe("pack-1");
    expect(result.content_pack.status).toBe("queued");
    expect(result.content_pack.week_number).toBe(1);
    expect(result.content_pack.item_ids).toEqual([]);

    // The pack is claimed atomically against the resolved week context.
    expect(packRepo.claimQueuedPack).toHaveBeenCalledWith(
      "cycle-1",
      1,
      "week-1",
    );

    // Exactly one generation job is enqueued with the pack identity and the
    // retry policy from the architecture pack.
    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(queue.add).toHaveBeenCalledWith(
      "generate-content",
      {
        contentCycleId: "cycle-1",
        weekNumber: 1,
        contentPackId: "pack-1",
        idempotencyKey: "gen-idem-1",
        correlationId: result.correlation_id,
      },
      { attempts: 3, backoff: { type: "exponential", delay: 2000 } },
    );

    expect(packRepo.appendProgressEvent).toHaveBeenCalledWith(
      "pack-1",
      expect.objectContaining({
        stage: "queued",
        status: "started",
        messageKey: "content.queued",
      }),
    );
  });

  it("returns the existing pack without enqueuing when another request already claimed the week", async () => {
    (packRepo.claimQueuedPack as jest.Mock).mockResolvedValue({
      pack: PACK_ROW,
      created: false,
    });

    const result = await service.generateWeek("cycle-1", 1, GENERATE_DTO, OWNER_ID);

    expect(result.status).toBe("queued");
    expect(result.content_pack.id).toBe("pack-1");
    expect(queue.add).not.toHaveBeenCalled();
    expect(packRepo.appendProgressEvent).not.toHaveBeenCalled();
  });

  it("falls back to the safe default week context when none exists yet", async () => {
    // listWeeks returns [] (makeWeekRepo default) and the repo falls back to
    // creating a system defaulted context.
    const result = await service.generateWeek("cycle-1", 3, GENERATE_DTO, OWNER_ID);

    expect(weekRepo.createSafeDefaultContext).toHaveBeenCalled();
    expect(packRepo.claimQueuedPack).toHaveBeenCalledWith(
      "cycle-1",
      3,
      "week-defaulted",
    );
    expect(result.content_pack.id).toBe("pack-1");
  });
});
