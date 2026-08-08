import { Test, TestingModule } from "@nestjs/testing";
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { getQueueToken } from "@nestjs/bullmq";
import { ContentService, planSelectedChannels } from "./content.service";
import { ContentCycleRepository } from "./repositories/content-cycle.repository";
import { ContentWeekContextRepository } from "./repositories/content-week-context.repository";
import { ContentPackRepository } from "./repositories/content-pack.repository";
import { ContentDecisionRepository } from "./repositories/content-decision.repository";
import type { ContentDecisionRow } from "./repositories/content-decision.repository";
import { PublicationCandidateRepository } from "./repositories/publication-candidate.repository";
import { ContentJobOutboxRepository } from "./content-job-outbox.repository";
import { StrategyRepository } from "../strategy/strategy.repository";
import { PrismaService } from "../../common/persistence/prisma.service";
import {
  AssetStorage,
  CONTENT_ASSET_STORAGE,
} from "./assets/asset-storage.port";
import {
  computePublicationCandidateChecksum,
  isPublicationCandidateChecksumValid,
} from "@marketmind/contracts";
import type {
  ContentDecisionRequest,
  CreateContentCycleRequest,
  GenerateContentPackRequest,
  PublicationCandidateV1,
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
  week1StartDate: new Date("2026-08-01T00:00:00.000Z"),
  nextGenerationAt: new Date("2026-08-07T21:00:00.000Z"),
  timezone: "Africa/Cairo",
  pauseReason: null,
  completedAt: null,
  ownerUserId: OWNER_ID,
  idempotencyKey: "idem-1",
  idempotencyFingerprint: "fingerprint-1",
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
  frozenAt: null,
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
  frozenAt: new Date("2026-08-15T00:00:00.000Z"),
  createdAt: new Date("2026-08-15T00:00:00.000Z"),
};

type MockedStrategyRepo = jest.Mocked<Partial<StrategyRepository>>;
type MockedCycleRepo = jest.Mocked<Partial<ContentCycleRepository>>;
type MockedWeekRepo = jest.Mocked<Partial<ContentWeekContextRepository>>;
type MockedPackRepo = jest.Mocked<Partial<ContentPackRepository>>;
type MockedDecisionRepo = jest.Mocked<Partial<ContentDecisionRepository>>;
type MockedCandidateRepo = jest.Mocked<Partial<PublicationCandidateRepository>>;

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

const DECISION_ROW: ContentDecisionRow = {
  id: "decision-1",
  contentItemId: "item-1",
  contentItemVersionId: "ver-2",
  contentItemVersion: 2,
  contentItemVersionChecksum: "checksum-2",
  decision: "approved",
  revisionNotes: null,
  decidedByUserId: OWNER_ID,
  decidedAt: new Date("2026-08-01T01:00:00.000Z"),
  ownerUserId: OWNER_ID,
  idempotencyKey: "decision-idem-1",
  createdAt: new Date("2026-08-01T01:00:00.000Z"),
};

const CANDIDATE_BASE: Omit<PublicationCandidateV1, "candidate_checksum"> = {
  contract_version: "publication-candidate-v1",
  candidate_id: "candidate-1",
  business_id: "biz-1",
  strategy_id: "strat-1",
  strategy_version: 2,
  content_cycle_id: "cycle-1",
  strategy_week_number: 1,
  content_pack_id: "pack-1",
  content_item_id: "item-1",
  content_item_version_id: "ver-2",
  content_item_version: 2,
  content_item_version_checksum: "checksum-2",
  target_channel: "instagram",
  content_format: "static_image_post",
  selected_locale: "ar",
  caption: "نص",
  cta: "call",
  hashtags: ["#cairo"],
  alt_text: "alt",
  assets: [],
  recommended_publish_window: {
    starts_at: "2026-08-08T00:00:00.000Z",
    ends_at: "2026-08-10T00:00:00.000Z",
    timezone: "Africa/Cairo",
  },
  approval: {
    decision_id: "decision-1",
    decision: "approved",
    content_item_version_id: "ver-2",
    content_item_version_checksum: "checksum-2",
    decided_by_user_id: OWNER_ID,
    decided_at: "2026-08-01T01:00:00.000Z",
  },
  created_at: "2026-08-01T01:00:00.000Z",
};

const CANDIDATE: PublicationCandidateV1 = {
  ...CANDIDATE_BASE,
  candidate_checksum: computePublicationCandidateChecksum({
    ...CANDIDATE_BASE,
    candidate_checksum: "",
  }),
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
    getDecisionById: jest.fn().mockResolvedValue({
      id: "decision-1",
      strategyVersionId: "v-2",
      ownerUserId: OWNER_ID,
      action: "approve",
      feedback: null,
    }),
    getVersionByNumber: jest.fn().mockResolvedValue({
      id: "v-2",
      strategyId: "strat-1",
      version: 2,
      retrievalRunId: null,
      planData: { selected_channels: [{ channel: "instagram" }] },
      promptConfig: {},
    }),
    ...overrides,
  };
}

function makeCycleRepo(
  overrides: Partial<MockedCycleRepo> = {},
): MockedCycleRepo {
  return {
    createCycle: jest.fn().mockResolvedValue(CYCLE_ROW),
    createCycleWithWeekOne: jest.fn().mockResolvedValue({
      cycle: CYCLE_ROW,
      weekContext: WEEK_ROW,
      pack: PACK_ROW,
      created: true,
    }),
    getCycleByIdAndOwner: jest.fn().mockResolvedValue(CYCLE_ROW),
    getCycleById: jest.fn().mockResolvedValue(CYCLE_ROW),
    pauseCycle: jest.fn().mockResolvedValue({
      ...CYCLE_ROW,
      status: "paused",
      pauseReason: "paused",
    }),
    resumeCycle: jest.fn().mockResolvedValue(CYCLE_ROW),
    ...overrides,
  };
}

function makeWeekRepo(overrides: Partial<MockedWeekRepo> = {}): MockedWeekRepo {
  return {
    upsertOwnerContext: jest.fn().mockResolvedValue(WEEK_ROW),
    listWeeks: jest.fn().mockResolvedValue([]),
    createSafeDefaultContext: jest
      .fn()
      .mockResolvedValue(SYSTEM_DEFAULTED_WEEK_ROW),
    ...overrides,
  };
}

function makePackRepo(overrides: Partial<MockedPackRepo> = {}): MockedPackRepo {
  return {
    claimQueuedPack: jest
      .fn()
      .mockResolvedValue({ pack: PACK_ROW, created: true }),
    getPackByIdAndOwner: jest.fn().mockResolvedValue(PACK_ROW),
    getProgressEvents: jest.fn().mockResolvedValue([]),
    listItemVersions: jest.fn().mockResolvedValue([]),
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
    getItemById: jest.fn().mockResolvedValue(null),
    listAssetsForVersion: jest.fn().mockResolvedValue([]),
    hasPackForWeek: jest.fn().mockResolvedValue(false),
    derivePackStatusFromItems: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeDecisionRepo(
  overrides: Partial<MockedDecisionRepo> = {},
): MockedDecisionRepo {
  return {
    recordDecision: jest.fn().mockResolvedValue(DECISION_ROW),
    ...overrides,
  };
}

function makeCandidateRepo(
  overrides: Partial<MockedCandidateRepo> = {},
): MockedCandidateRepo {
  return {
    createCandidate: jest
      .fn()
      .mockResolvedValue({ candidate: CANDIDATE, outboxEventId: "outbox-1" }),
    getCandidateByItemVersionId: jest.fn().mockResolvedValue(null),
    ...overrides,
  };
}

function makePrismaService(overrides: Record<string, unknown> = {}) {
  return {
    $transaction: jest.fn(async (callback: (tx: unknown) => unknown) =>
      callback({}),
    ),
    ...overrides,
  };
}

function makeAssetStorage(): jest.Mocked<AssetStorage> {
  return {
    store: jest.fn(),
    retrieve: jest.fn(),
    exists: jest.fn(),
    delete: jest.fn(),
  };
}

/** Extracts the `code` from a Nest HttpException response body. */
function errorCode(error: unknown): string | undefined {
  if (
    error instanceof BadRequestException ||
    error instanceof ConflictException
  ) {
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
  let packRepo: MockedPackRepo;

  beforeEach(async () => {
    strategyRepo = makeStrategyRepo();
    cycleRepo = makeCycleRepo();
    weekRepo = makeWeekRepo();
    packRepo = makePackRepo();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContentService,
        { provide: StrategyRepository, useValue: strategyRepo },
        { provide: ContentCycleRepository, useValue: cycleRepo },
        { provide: ContentWeekContextRepository, useValue: weekRepo },
        { provide: ContentPackRepository, useValue: packRepo },
        {
          provide: getQueueToken("content-generation"),
          useValue: { add: jest.fn() },
        },
        {
          provide: getQueueToken("content-outbox"),
          useValue: { add: jest.fn() },
        },
        { provide: ContentDecisionRepository, useValue: makeDecisionRepo() },
        {
          provide: PublicationCandidateRepository,
          useValue: makeCandidateRepo(),
        },
        { provide: PrismaService, useValue: makePrismaService() },
        { provide: CONTENT_ASSET_STORAGE, useValue: makeAssetStorage() },
      ],
    }).compile();

    service = module.get<ContentService>(ContentService);
  });

  it("throws NotFound when the Strategy does not exist or is not owned by the caller", async () => {
    (strategyRepo.getStrategyByIdAndOwner as jest.Mock).mockResolvedValue(null);

    await expect(service.createCycle(DTO, OWNER_ID)).rejects.toThrow(
      NotFoundException,
    );
  });

  it("rejects with CONTENT_STRATEGY_NOT_APPROVED when the Strategy is not approved", async () => {
    (strategyRepo.getStrategyByIdAndOwner as jest.Mock).mockResolvedValue(
      makeStrategyRow({ status: "draft" }),
    );

    await rejectsWithCode(
      service.createCycle(DTO, OWNER_ID),
      "CONTENT_STRATEGY_NOT_APPROVED",
    );
  });

  it("rejects with CONTENT_STRATEGY_NOT_APPROVED when strategy_version is not the current approved version", async () => {
    (strategyRepo.getVersionById as jest.Mock).mockResolvedValue({
      id: "v-3",
      strategyId: "strat-1",
      version: 3,
    });

    await rejectsWithCode(
      service.createCycle(DTO, OWNER_ID),
      "CONTENT_STRATEGY_NOT_APPROVED",
    );
  });

  it("rejects with CONTENT_STRATEGY_NOT_APPROVED when the current version belongs to another Strategy", async () => {
    (strategyRepo.getVersionById as jest.Mock).mockResolvedValue({
      id: "v-2",
      strategyId: "strat-other",
      version: 2,
    });

    await rejectsWithCode(
      service.createCycle(DTO, OWNER_ID),
      "CONTENT_STRATEGY_NOT_APPROVED",
    );
  });

  it("rejects with CONTENT_PROFILE_STALE when the approved profile is no longer the active confirmed one", async () => {
    (
      strategyRepo.getActiveConfirmedProfileVersion as jest.Mock
    ).mockResolvedValue({
      id: "prof-2",
    });

    await rejectsWithCode(
      service.createCycle(DTO, OWNER_ID),
      "CONTENT_PROFILE_STALE",
    );
  });

  it("rejects owner-managed v2 Strategies with a non-retryable CONTENT_SCHEMA_FAILURE", async () => {
    // Website/delivery-only strategy-v2 plans have an explicitly unavailable
    // content handoff; they must never create an empty Content cycle.
    (strategyRepo.getVersionById as jest.Mock).mockResolvedValue({
      id: "v-2",
      strategyId: "strat-1",
      version: 2,
      planData: {
        contract_version: "strategy-v2",
        content_handoff: {
          available: false,
          reason: "no_content_supported_channels",
          message: "owner-managed plan",
        },
      },
    });

    await rejectsWithCode(
      service.createCycle(DTO, OWNER_ID),
      "CONTENT_SCHEMA_FAILURE",
    );
    expect(cycleRepo.createCycleWithWeekOne).not.toHaveBeenCalled();
    expect(packRepo.claimQueuedPack).not.toHaveBeenCalled();
  });

  it("creates the cycle and initial owner-confirmed week context for week 1", async () => {
    const result = await service.createCycle(DTO, OWNER_ID);

    expect(result.content_cycle.id).toBe("cycle-1");
    expect(result.initial_week_context.week_number).toBe(1);
    expect(result.initial_week_context.week_start_date).toBe("2026-08-01");
    expect(result.initial_week_context.context_source).toBe("owner_confirmed");

    expect(cycleRepo.createCycleWithWeekOne).toHaveBeenCalledWith(
      expect.objectContaining({
        businessId: "biz-1",
        strategyId: "strat-1",
        strategyVersion: 2,
        strategyDecisionId: "decision-1",
        profileVersionId: "prof-1",
        idempotencyKey: "idem-1",
        week1StartDate: new Date("2026-08-01T00:00:00.000Z"),
        initialWeekContext: expect.objectContaining({
          week_number: 1,
          week_start_date: "2026-08-01",
        }),
      }),
      OWNER_ID,
    );

    // Week 1 cutoff = start of week 2 in Africa/Cairo (end of the current
    // Strategy week). The Cairo date of the persisted cutoff must be
    // 2026-08-08 (strategy start + 7 days).
    const cutoff = (cycleRepo.createCycleWithWeekOne as jest.Mock).mock
      .calls[0][0].nextGenerationAt as Date;
    expect(cutoff).toBeInstanceOf(Date);
    const cairoDate = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Africa/Cairo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(cutoff);
    expect(cairoDate).toBe("2026-08-08");

    // Issue #110 requires week 1 to be queued immediately on cycle creation.
    expect(packRepo.claimQueuedPack).toHaveBeenCalledWith(
      "cycle-1",
      1,
      expect.any(String),
    );
  });

  it("returns the same cycle on idempotent replay (repository returns the original row)", async () => {
    const replayCycle = { ...CYCLE_ROW, id: "cycle-original" };
    (cycleRepo.createCycleWithWeekOne as jest.Mock).mockResolvedValue({
      cycle: replayCycle,
      weekContext: WEEK_ROW,
      pack: PACK_ROW,
      created: false,
    });

    const result = await service.createCycle(DTO, OWNER_ID);

    expect(result.content_cycle.id).toBe("cycle-original");
    expect(cycleRepo.createCycleWithWeekOne).toHaveBeenCalledTimes(1);
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
        {
          provide: getQueueToken("content-generation"),
          useValue: { add: jest.fn() },
        },
        {
          provide: getQueueToken("content-outbox"),
          useValue: { add: jest.fn() },
        },
        { provide: ContentDecisionRepository, useValue: makeDecisionRepo() },
        {
          provide: PublicationCandidateRepository,
          useValue: makeCandidateRepo(),
        },
        { provide: PrismaService, useValue: makePrismaService() },
        { provide: CONTENT_ASSET_STORAGE, useValue: makeAssetStorage() },
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
      service.upsertWeekContext(
        "cycle-1",
        1,
        DTO.initial_week_context,
        OWNER_ID,
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it("rejects with CONTENT_CYCLE_PAUSED when the cycle is paused", async () => {
    (cycleRepo.getCycleByIdAndOwner as jest.Mock).mockResolvedValue({
      ...CYCLE_ROW,
      status: "paused",
    });

    await rejectsWithCode(
      service.upsertWeekContext(
        "cycle-1",
        1,
        DTO.initial_week_context,
        OWNER_ID,
      ),
      "CONTENT_CYCLE_PAUSED",
    );
  });

  it("rejects with CONTENT_CYCLE_COMPLETED when the cycle is completed", async () => {
    (cycleRepo.getCycleByIdAndOwner as jest.Mock).mockResolvedValue({
      ...CYCLE_ROW,
      status: "completed",
    });

    await rejectsWithCode(
      service.upsertWeekContext(
        "cycle-1",
        1,
        DTO.initial_week_context,
        OWNER_ID,
      ),
      "CONTENT_CYCLE_COMPLETED",
    );
  });

  it("rejects with CONTENT_WEEK_OUT_OF_RANGE for weeks outside 1-12", async () => {
    await rejectsWithCode(
      service.upsertWeekContext(
        "cycle-1",
        0,
        DTO.initial_week_context,
        OWNER_ID,
      ),
      "CONTENT_WEEK_OUT_OF_RANGE",
    );
    await rejectsWithCode(
      service.upsertWeekContext(
        "cycle-1",
        13,
        DTO.initial_week_context,
        OWNER_ID,
      ),
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
      {
        ...DTO.initial_week_context,
        week_number: 4,
        week_start_date: "2026-01-01",
      },
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
      service.upsertWeekContext(
        "cycle-1",
        1,
        DTO.initial_week_context,
        OWNER_ID,
      ),
      "CONTENT_WEEK_ALREADY_CLAIMED",
    );
  });

  it("rejects with CONTENT_WEEK_ALREADY_CLAIMED when a system safe default already claimed the week", async () => {
    (weekRepo.listWeeks as jest.Mock).mockResolvedValue([
      { ...SYSTEM_DEFAULTED_WEEK_ROW, weekNumber: 1 },
    ]);

    await rejectsWithCode(
      service.upsertWeekContext(
        "cycle-1",
        1,
        DTO.initial_week_context,
        OWNER_ID,
      ),
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
        {
          provide: getQueueToken("content-generation"),
          useValue: { add: jest.fn() },
        },
        {
          provide: getQueueToken("content-outbox"),
          useValue: { add: jest.fn() },
        },
        { provide: ContentDecisionRepository, useValue: makeDecisionRepo() },
        {
          provide: PublicationCandidateRepository,
          useValue: makeCandidateRepo(),
        },
        { provide: PrismaService, useValue: makePrismaService() },
        { provide: CONTENT_ASSET_STORAGE, useValue: makeAssetStorage() },
      ],
    }).compile();

    service = module.get<ContentService>(ContentService);
  });

  it("throws NotFound when the cycle does not exist", async () => {
    (cycleRepo.getCycleById as jest.Mock).mockResolvedValue(null);

    await expect(service.safeDefaultWeekContext("cycle-1", 3)).rejects.toThrow(
      NotFoundException,
    );
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
    (cycleRepo.getCycleById as jest.Mock).mockResolvedValue({
      ...CYCLE_ROW,
      currentWeekNumber: 2,
    });
    const result = await service.safeDefaultWeekContext("cycle-1", 3);

    // Week 3 starts 2026-08-15 (week 2 start + 7) and its cutoff is the start
    // of week 4 (2026-08-22) in Africa/Cairo.
    expect(weekRepo.createSafeDefaultContext).toHaveBeenCalledWith(
      "cycle-1",
      3,
      expect.objectContaining({
        weekStartDate: new Date("2026-08-15T00:00:00.000Z"),
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
        {
          provide: getQueueToken("content-outbox"),
          useValue: { add: jest.fn() },
        },
        { provide: ContentDecisionRepository, useValue: makeDecisionRepo() },
        {
          provide: PublicationCandidateRepository,
          useValue: makeCandidateRepo(),
        },
        { provide: PrismaService, useValue: makePrismaService() },
        { provide: CONTENT_ASSET_STORAGE, useValue: makeAssetStorage() },
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

    const result = await service.generateWeek(
      "cycle-1",
      1,
      GENERATE_DTO,
      OWNER_ID,
    );

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
      pack: { ...PACK_ROW, itemIds: ["item-1"] },
      created: false,
    });

    const result = await service.generateWeek(
      "cycle-1",
      1,
      GENERATE_DTO,
      OWNER_ID,
    );

    expect(result.status).toBe("queued");
    expect(result.content_pack.id).toBe("pack-1");
    expect(queue.add).not.toHaveBeenCalled();
    expect(packRepo.appendProgressEvent).not.toHaveBeenCalled();
  });

  it("falls back to the safe default week context when none exists yet", async () => {
    // listWeeks returns [] (makeWeekRepo default) and the repo falls back to
    // creating a system defaulted context.
    (cycleRepo.getCycleByIdAndOwner as jest.Mock).mockResolvedValue({
      ...CYCLE_ROW,
      currentWeekNumber: 2,
    });
    (cycleRepo.getCycleById as jest.Mock).mockResolvedValue({
      ...CYCLE_ROW,
      currentWeekNumber: 2,
    });
    const result = await service.generateWeek(
      "cycle-1",
      3,
      GENERATE_DTO,
      OWNER_ID,
    );

    expect(weekRepo.createSafeDefaultContext).toHaveBeenCalled();
    expect(packRepo.claimQueuedPack).toHaveBeenCalledWith(
      "cycle-1",
      3,
      "week-defaulted",
    );
    expect(result.content_pack.id).toBe("pack-1");
  });
});

const PROGRESS_EVENT_ROW = {
  id: 1n,
  contentPackId: "pack-1",
  seq: 2,
  stage: "generating",
  status: "progress",
  messageKey: "content.generating",
  messageText: "Generating items.",
  payload: {},
  createdAt: new Date("2026-08-01T01:00:00.000Z"),
};

const ITEM_VERSION_ROW = {
  id: "ver-2",
  contractVersion: "content-v1",
  contentItemId: "item-1",
  contentPackId: "pack-1",
  version: 2,
  channel: "instagram",
  format: "post",
  languageMode: "ar",
  strategyTrace: {
    strategy_id: "strat-1",
    strategy_version: 2,
    week_number: 1,
    pillar_ids: ["pillar-1"],
    objective: "awareness",
    channel: "instagram",
  },
  captionVariants: [{ locale: "ar", caption: "نص" }],
  cta: "call",
  hashtags: ["#cairo"],
  creativeBrief: "brief",
  altText: "alt",
  shortVideoScript: null,
  recommendedPublishWindow: { starts_at: "2026-08-08", ends_at: "2026-08-10" },
  claimSources: [
    { claim_type: "price", source_type: "business", approved: true },
  ],
  warnings: [],
  blockers: [],
  assetRequired: false,
  assetIds: [],
  generationProvenance: { provider: "mock", model: "mock" },
  versionChecksum: "checksum-2",
  createdAt: new Date("2026-08-01T00:30:00.000Z"),
};

describe("ContentService.reads", () => {
  let service: ContentService;
  let cycleRepo: MockedCycleRepo;
  let weekRepo: MockedWeekRepo;
  let packRepo: MockedPackRepo;

  beforeEach(async () => {
    cycleRepo = makeCycleRepo();
    weekRepo = makeWeekRepo();
    packRepo = makePackRepo();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContentService,
        { provide: StrategyRepository, useValue: makeStrategyRepo() },
        { provide: ContentCycleRepository, useValue: cycleRepo },
        { provide: ContentWeekContextRepository, useValue: weekRepo },
        { provide: ContentPackRepository, useValue: packRepo },
        {
          provide: getQueueToken("content-generation"),
          useValue: { add: jest.fn() },
        },
        {
          provide: getQueueToken("content-outbox"),
          useValue: { add: jest.fn() },
        },
        { provide: ContentDecisionRepository, useValue: makeDecisionRepo() },
        {
          provide: PublicationCandidateRepository,
          useValue: makeCandidateRepo(),
        },
        { provide: PrismaService, useValue: makePrismaService() },
        { provide: CONTENT_ASSET_STORAGE, useValue: makeAssetStorage() },
      ],
    }).compile();

    service = module.get<ContentService>(ContentService);
  });

  describe("getCycle", () => {
    it("returns the mapped cycle for the owner", async () => {
      const result = await service.getCycle("cycle-1", OWNER_ID);

      expect(result.id).toBe("cycle-1");
      expect(result.status).toBe("active");
      expect(result.contract_version).toBe("content-v1");
      expect(result.current_week_number).toBe(1);
      expect(cycleRepo.getCycleByIdAndOwner).toHaveBeenCalledWith(
        "cycle-1",
        OWNER_ID,
      );
    });

    it("throws NotFound on cross-owner access", async () => {
      (cycleRepo.getCycleByIdAndOwner as jest.Mock).mockResolvedValue(null);

      await expect(service.getCycle("cycle-1", "other-user")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("listWeeks", () => {
    it("returns weeks mapped to the contract type", async () => {
      (weekRepo.listWeeks as jest.Mock).mockResolvedValue([
        WEEK_ROW,
        SYSTEM_DEFAULTED_WEEK_ROW,
      ]);

      const result = await service.listWeeks("cycle-1", OWNER_ID);

      expect(result.weeks).toHaveLength(2);
      expect(result.weeks[0].week_number).toBe(1);
      expect(result.weeks[0].context_source).toBe("owner_confirmed");
      expect(result.weeks[1].context_source).toBe("system_defaulted");
    });

    it("throws NotFound when the cycle is not owned by the caller", async () => {
      (cycleRepo.getCycleByIdAndOwner as jest.Mock).mockResolvedValue(null);

      await expect(service.listWeeks("cycle-1", "other-user")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("getPack", () => {
    it("returns the mapped pack for the owner", async () => {
      const result = await service.getPack("pack-1", OWNER_ID);

      expect(result.id).toBe("pack-1");
      expect(result.content_cycle_id).toBe("cycle-1");
      expect(result.week_number).toBe(1);
      expect(result.status).toBe("queued");
    });

    it("throws NotFound on cross-owner access", async () => {
      (packRepo.getPackByIdAndOwner as jest.Mock).mockResolvedValue(null);

      await expect(service.getPack("pack-1", "other-user")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("getPackProgress", () => {
    it("returns progress events in seq order", async () => {
      (packRepo.getProgressEvents as jest.Mock).mockResolvedValue([
        { ...PROGRESS_EVENT_ROW, seq: 1 },
        { ...PROGRESS_EVENT_ROW, seq: 2 },
      ]);

      const result = await service.getPackProgress("pack-1", OWNER_ID);

      expect(result.map((event) => event.seq)).toEqual([1, 2]);
      expect(result[1].type).toBe("content_progress");
      expect(result[1].content_pack_id).toBe("pack-1");
      expect(result[1].stage).toBe("generating");
    });

    it("throws NotFound when the pack is not owned by the caller", async () => {
      (packRepo.getPackByIdAndOwner as jest.Mock).mockResolvedValue(null);

      await expect(
        service.getPackProgress("pack-1", "other-user"),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("getItemVersions", () => {
    it("returns versions in version-descending order", async () => {
      (packRepo.listItemVersions as jest.Mock).mockResolvedValue([
        { ...ITEM_VERSION_ROW, version: 2 },
        {
          ...ITEM_VERSION_ROW,
          version: 1,
          id: "ver-1",
          versionChecksum: "checksum-1",
        },
      ]);

      const result = await service.getItemVersions(
        "pack-1",
        "item-1",
        OWNER_ID,
      );

      expect(result.map((version) => version.version)).toEqual([2, 1]);
      expect(result[0].id).toBe("ver-2");
      expect(result[0].content_item_id).toBe("item-1");
      expect(result[0].version_checksum).toBe("checksum-2");
      expect(packRepo.listItemVersions).toHaveBeenCalledWith(
        "pack-1",
        "item-1",
      );
    });

    it("throws NotFound when the pack is not owned by the caller", async () => {
      (packRepo.getPackByIdAndOwner as jest.Mock).mockResolvedValue(null);

      await expect(
        service.getItemVersions("pack-1", "item-1", "other-user"),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("getPackRetryEligibility", () => {
    it("returns retry_eligible from the pack row", async () => {
      const result = await service.getPackRetryEligibility("pack-1", OWNER_ID);

      expect(result).toEqual({ retry_eligible: true });
    });

    it("returns retry_eligible=false for a non-retryable pack", async () => {
      (packRepo.getPackByIdAndOwner as jest.Mock).mockResolvedValue({
        ...PACK_ROW,
        retryEligible: false,
      });

      const result = await service.getPackRetryEligibility("pack-1", OWNER_ID);

      expect(result).toEqual({ retry_eligible: false });
    });

    it("throws NotFound on cross-owner access", async () => {
      (packRepo.getPackByIdAndOwner as jest.Mock).mockResolvedValue(null);

      await expect(
        service.getPackRetryEligibility("pack-1", "other-user"),
      ).rejects.toThrow(NotFoundException);
    });
  });
});

describe("ContentService.decide", () => {
  let service: ContentService;
  let strategyRepo: MockedStrategyRepo;
  let packRepo: MockedPackRepo;
  let decisionRepo: MockedDecisionRepo;
  let candidateRepo: MockedCandidateRepo;

  const DECIDE_PACK_ROW = {
    ...PACK_ROW,
    status: "draft",
    weeklyClaimId: "claim-1",
    itemIds: ["item-1", "item-2", "item-3"],
  };

  const DECIDE_ITEM_ROW = {
    id: "item-1",
    contentPackId: "pack-1",
    status: "draft",
    currentVersionId: "ver-2",
  };

  const APPROVE_DTO: ContentDecisionRequest = {
    content_item_id: "item-1",
    content_item_version_id: "ver-2",
    content_item_version_checksum: "checksum-2",
    decision: "approved",
    revision_notes: null,
    idempotency_key: "decision-idem-1",
  };

  beforeEach(async () => {
    strategyRepo = makeStrategyRepo();
    packRepo = makePackRepo({
      getPackByIdAndOwner: jest.fn().mockResolvedValue(DECIDE_PACK_ROW),
      getItemById: jest.fn().mockResolvedValue(DECIDE_ITEM_ROW),
      listItemVersions: jest.fn().mockResolvedValue([ITEM_VERSION_ROW]),
      listAssetsForVersion: jest.fn().mockResolvedValue([]),
    });
    decisionRepo = makeDecisionRepo();
    candidateRepo = makeCandidateRepo();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContentService,
        { provide: StrategyRepository, useValue: strategyRepo },
        { provide: ContentCycleRepository, useValue: makeCycleRepo() },
        {
          provide: ContentWeekContextRepository,
          useValue: makeWeekRepo({
            listWeeks: jest.fn().mockResolvedValue([WEEK_ROW]),
          }),
        },
        { provide: ContentPackRepository, useValue: packRepo },
        {
          provide: getQueueToken("content-generation"),
          useValue: { add: jest.fn() },
        },
        {
          provide: getQueueToken("content-outbox"),
          useValue: { add: jest.fn() },
        },
        { provide: ContentDecisionRepository, useValue: decisionRepo },
        { provide: PublicationCandidateRepository, useValue: candidateRepo },
        { provide: PrismaService, useValue: makePrismaService() },
        { provide: CONTENT_ASSET_STORAGE, useValue: makeAssetStorage() },
      ],
    }).compile();

    service = module.get<ContentService>(ContentService);
  });

  it("throws NotFound when the pack is not owned by the caller", async () => {
    (packRepo.getPackByIdAndOwner as jest.Mock).mockResolvedValue(null);

    await expect(
      service.decide("pack-1", "item-1", APPROVE_DTO, "other-user"),
    ).rejects.toThrow(NotFoundException);
  });

  it("throws NotFound when the content item is missing", async () => {
    (packRepo.getItemById as jest.Mock).mockResolvedValue(null);

    await expect(
      service.decide("pack-1", "item-1", APPROVE_DTO, OWNER_ID),
    ).rejects.toThrow(NotFoundException);
  });

  it("throws CONTENT_VERSION_CONFLICT when the item has no current version", async () => {
    (packRepo.getItemById as jest.Mock).mockResolvedValue({
      ...DECIDE_ITEM_ROW,
      currentVersionId: null,
    });

    await rejectsWithCode(
      service.decide("pack-1", "item-1", APPROVE_DTO, OWNER_ID),
      "CONTENT_VERSION_CONFLICT",
    );
  });

  it("throws CONTENT_VERSION_CONFLICT when the submitted version id is stale", async () => {
    await rejectsWithCode(
      service.decide(
        "pack-1",
        "item-1",
        { ...APPROVE_DTO, content_item_version_id: "ver-1" },
        OWNER_ID,
      ),
      "CONTENT_VERSION_CONFLICT",
    );
  });

  it("throws CONTENT_VERSION_CONFLICT when the submitted checksum mismatches", async () => {
    await rejectsWithCode(
      service.decide(
        "pack-1",
        "item-1",
        { ...APPROVE_DTO, content_item_version_checksum: "wrong" },
        OWNER_ID,
      ),
      "CONTENT_VERSION_CONFLICT",
    );
  });

  it("throws CONTENT_APPROVAL_BLOCKED when the pack is not draft or partially approved", async () => {
    (packRepo.getPackByIdAndOwner as jest.Mock).mockResolvedValue({
      ...DECIDE_PACK_ROW,
      status: "queued",
    });

    await rejectsWithCode(
      service.decide("pack-1", "item-1", APPROVE_DTO, OWNER_ID),
      "CONTENT_APPROVAL_BLOCKED",
    );
  });

  it("throws CONTENT_ASSET_REQUIRED when approval needs a ready asset that is missing", async () => {
    (packRepo.listItemVersions as jest.Mock).mockResolvedValue([
      { ...ITEM_VERSION_ROW, assetRequired: true },
    ]);

    await rejectsWithCode(
      service.decide("pack-1", "item-1", APPROVE_DTO, OWNER_ID),
      "CONTENT_ASSET_REQUIRED",
    );
  });

  it("throws CONTENT_APPROVAL_BLOCKED when the policy fixture is invalid", async () => {
    (strategyRepo.getStrategyByIdAndOwner as jest.Mock).mockResolvedValue({
      ...makeStrategyRow(),
      status: "draft",
    });

    await rejectsWithCode(
      service.decide("pack-1", "item-1", APPROVE_DTO, OWNER_ID),
      "CONTENT_APPROVAL_BLOCKED",
    );
  });

  it("approves: records the decision and creates a publication candidate", async () => {
    const result = await service.decide(
      "pack-1",
      "item-1",
      APPROVE_DTO,
      OWNER_ID,
    );

    expect(decisionRepo.recordDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        itemId: "item-1",
        versionId: "ver-2",
        versionNumber: 2,
        versionChecksum: "checksum-2",
        decision: "approved",
        ownerUserId: OWNER_ID,
        idempotencyKey: "decision-idem-1",
      }),
      expect.anything(),
    );
    expect(candidateRepo.getCandidateByItemVersionId).toHaveBeenCalledWith(
      "ver-2",
      expect.anything(),
    );
    expect(candidateRepo.createCandidate).toHaveBeenCalledTimes(1);
    expect(result.publication_candidate).toEqual(CANDIDATE);
    expect(result.decision.decision).toBe("approved");
    expect(result.decision.content_item_version_id).toBe("ver-2");
  });

  it("rejects: records the decision without creating a candidate", async () => {
    (decisionRepo.recordDecision as jest.Mock).mockResolvedValue({
      ...DECISION_ROW,
      decision: "rejected",
    });

    const result = await service.decide(
      "pack-1",
      "item-1",
      { ...APPROVE_DTO, decision: "rejected" },
      OWNER_ID,
    );

    expect(candidateRepo.createCandidate).not.toHaveBeenCalled();
    expect(candidateRepo.getCandidateByItemVersionId).not.toHaveBeenCalled();
    expect(result.publication_candidate).toBeNull();
    expect(result.decision.decision).toBe("rejected");
  });

  it("returns the existing candidate on decision replay without duplicating", async () => {
    (candidateRepo.getCandidateByItemVersionId as jest.Mock).mockResolvedValue(
      CANDIDATE,
    );

    const result = await service.decide(
      "pack-1",
      "item-1",
      APPROVE_DTO,
      OWNER_ID,
    );

    expect(candidateRepo.createCandidate).not.toHaveBeenCalled();
    expect(result.publication_candidate).toEqual(CANDIDATE);
  });
});

describe("ContentService.bulkDecision", () => {
  let service: ContentService;
  let strategyRepo: MockedStrategyRepo;
  let packRepo: MockedPackRepo;
  let decisionRepo: MockedDecisionRepo;
  let candidateRepo: MockedCandidateRepo;
  let generationQueue: { add: jest.Mock };
  let jobOutbox: {
    createIntent: jest.Mock;
    markDirectDispatched: jest.Mock;
  };

  const BULK_PACK_ROW = {
    ...PACK_ROW,
    status: "draft",
    weeklyClaimId: "claim-1",
    itemIds: ["item-1", "item-2", "item-3"],
  };

  const BULK_ITEM_1_ROW = {
    id: "item-1",
    contentPackId: "pack-1",
    status: "draft",
    currentVersionId: "ver-2",
  };

  const ITEM_2_ROW = {
    id: "item-2",
    contentPackId: "pack-1",
    status: "draft",
    currentVersionId: "ver-2b",
  };

  const ITEM_3_ROW = {
    id: "item-3",
    contentPackId: "pack-1",
    status: "draft",
    currentVersionId: "ver-2c",
  };

  const VERSION_2B_ROW = {
    ...ITEM_VERSION_ROW,
    id: "ver-2b",
    contentItemId: "item-2",
    versionChecksum: "checksum-2b",
  };

  const VERSION_2C_ROW = {
    ...ITEM_VERSION_ROW,
    id: "ver-2c",
    contentItemId: "item-3",
    versionChecksum: "checksum-2c",
  };

  const BULK_DTO: ContentDecisionRequest[] = [
    {
      content_item_id: "item-1",
      content_item_version_id: "ver-2",
      content_item_version_checksum: "checksum-2",
      decision: "approved",
      revision_notes: null,
      idempotency_key: "bulk-idem-1",
    },
    {
      content_item_id: "item-2",
      content_item_version_id: "ver-2b",
      content_item_version_checksum: "checksum-2b",
      decision: "approved",
      revision_notes: null,
      idempotency_key: "bulk-idem-2",
    },
    {
      content_item_id: "item-3",
      content_item_version_id: "ver-2c",
      content_item_version_checksum: "checksum-2c",
      decision: "approved",
      revision_notes: null,
      idempotency_key: "bulk-idem-3",
    },
  ];

  const bulkDecisionsFor = (itemIds: string[]): ContentDecisionRow[] =>
    itemIds.map((itemId) => ({
      ...DECISION_ROW,
      id: `decision-${itemId}`,
      contentItemId: itemId,
      contentItemVersionId:
        itemId === "item-1"
          ? "ver-2"
          : itemId === "item-2"
            ? "ver-2b"
            : "ver-2c",
      idempotencyKey: `bulk-idem-${itemId.slice(-1)}`,
    }));

  beforeEach(async () => {
    strategyRepo = makeStrategyRepo();
    packRepo = makePackRepo({
      getPackByIdAndOwner: jest.fn().mockResolvedValue(BULK_PACK_ROW),
      getItemById: jest.fn().mockImplementation((_packId, itemId) => {
        if (itemId === "item-1") return Promise.resolve(BULK_ITEM_1_ROW);
        if (itemId === "item-2") return Promise.resolve(ITEM_2_ROW);
        return Promise.resolve(ITEM_3_ROW);
      }),
      listItemVersions: jest.fn().mockImplementation((_packId, itemId) => {
        if (itemId === "item-1") return Promise.resolve([ITEM_VERSION_ROW]);
        if (itemId === "item-2") return Promise.resolve([VERSION_2B_ROW]);
        return Promise.resolve([VERSION_2C_ROW]);
      }),
      listAssetsForVersion: jest.fn().mockResolvedValue([]),
    });
    decisionRepo = makeDecisionRepo({
      bulkRecordDecisions: jest.fn().mockResolvedValue({
        decisions: bulkDecisionsFor(["item-1", "item-2", "item-3"]),
        errors: [],
      }),
    });
    candidateRepo = makeCandidateRepo();
    generationQueue = { add: jest.fn().mockResolvedValue({ id: "job-1" }) };
    jobOutbox = {
      createIntent: jest.fn().mockResolvedValue({}),
      markDirectDispatched: jest.fn().mockResolvedValue(true),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContentService,
        { provide: StrategyRepository, useValue: strategyRepo },
        { provide: ContentCycleRepository, useValue: makeCycleRepo() },
        {
          provide: ContentWeekContextRepository,
          useValue: makeWeekRepo({
            listWeeks: jest.fn().mockResolvedValue([WEEK_ROW]),
          }),
        },
        { provide: ContentPackRepository, useValue: packRepo },
        {
          provide: getQueueToken("content-generation"),
          useValue: generationQueue,
        },
        {
          provide: getQueueToken("content-outbox"),
          useValue: { add: jest.fn() },
        },
        { provide: ContentDecisionRepository, useValue: decisionRepo },
        { provide: PublicationCandidateRepository, useValue: candidateRepo },
        { provide: PrismaService, useValue: makePrismaService() },
        { provide: CONTENT_ASSET_STORAGE, useValue: makeAssetStorage() },
        { provide: ContentJobOutboxRepository, useValue: jobOutbox },
      ],
    }).compile();

    service = module.get<ContentService>(ContentService);
  });

  it("throws NotFound when the pack is not owned by the caller", async () => {
    (packRepo.getPackByIdAndOwner as jest.Mock).mockResolvedValue(null);

    await expect(
      service.bulkDecide("pack-1", BULK_DTO, "other-user"),
    ).rejects.toThrow(NotFoundException);
  });

  it("throws CONTENT_APPROVAL_BLOCKED when the pack is not draft or partially approved", async () => {
    (packRepo.getPackByIdAndOwner as jest.Mock).mockResolvedValue({
      ...BULK_PACK_ROW,
      status: "queued",
    });

    await rejectsWithCode(
      service.bulkDecide("pack-1", BULK_DTO, OWNER_ID),
      "CONTENT_APPROVAL_BLOCKED",
    );
  });

  it("approves all eligible items and creates one candidate per approval", async () => {
    const result = await service.bulkDecide("pack-1", BULK_DTO, OWNER_ID);

    expect(decisionRepo.bulkRecordDecisions).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          itemId: "item-1",
          idempotencyKey: "bulk-idem-1",
        }),
        expect.objectContaining({
          itemId: "item-2",
          idempotencyKey: "bulk-idem-2",
        }),
        expect.objectContaining({
          itemId: "item-3",
          idempotencyKey: "bulk-idem-3",
        }),
      ],
      OWNER_ID,
      expect.anything(),
    );
    expect(candidateRepo.createCandidate).toHaveBeenCalledTimes(3);
    expect(result).toHaveLength(3);
    expect(result.every((entry) => entry.status === "approved")).toBe(true);
  });

  it("reports a stale-checksum item as ineligible while committing the rest", async () => {
    (decisionRepo.bulkRecordDecisions as jest.Mock).mockResolvedValue({
      decisions: bulkDecisionsFor(["item-1", "item-3"]),
      errors: [],
    });

    const stale = BULK_DTO.map((request) =>
      request.content_item_id === "item-2"
        ? { ...request, content_item_version_checksum: "wrong-checksum" }
        : request,
    );

    const result = await service.bulkDecide("pack-1", stale, OWNER_ID);

    expect(decisionRepo.bulkRecordDecisions).toHaveBeenCalledTimes(1);
    expect(decisionRepo.bulkRecordDecisions).toHaveBeenCalledWith(
      [
        expect.objectContaining({ itemId: "item-1" }),
        expect.objectContaining({ itemId: "item-3" }),
      ],
      OWNER_ID,
      expect.anything(),
    );
    expect(result).toHaveLength(3);
    expect(result.find((entry) => entry.item_id === "item-2")).toEqual({
      item_id: "item-2",
      status: "ineligible",
      error: {
        code: "CONTENT_VERSION_CONFLICT",
        message: expect.any(String),
        latest_version_id: "ver-2b",
      },
    });
    expect(result.find((entry) => entry.item_id === "item-1")?.status).toBe(
      "approved",
    );
    expect(result.find((entry) => entry.item_id === "item-3")?.status).toBe(
      "approved",
    );
  });

  it("reports a repository-rejected item per-item without rolling back the rest", async () => {
    (decisionRepo.bulkRecordDecisions as jest.Mock).mockResolvedValue({
      decisions: bulkDecisionsFor(["item-1", "item-3"]),
      errors: [
        {
          itemId: "item-2",
          code: "CONTENT_APPROVAL_BLOCKED",
          message: "This item version already has a decision.",
        },
      ],
    });

    const result = await service.bulkDecide("pack-1", BULK_DTO, OWNER_ID);

    expect(result.find((entry) => entry.item_id === "item-2")).toEqual({
      item_id: "item-2",
      status: "ineligible",
      error: { code: "CONTENT_APPROVAL_BLOCKED", message: expect.any(String) },
    });
    expect(result.find((entry) => entry.item_id === "item-1")?.status).toBe(
      "approved",
    );
  });

  it("commits nothing when every request is ineligible", async () => {
    const allStale = BULK_DTO.map((request) => ({
      ...request,
      content_item_version_checksum: "wrong-checksum",
    }));

    const result = await service.bulkDecide("pack-1", allStale, OWNER_ID);

    expect(decisionRepo.bulkRecordDecisions).not.toHaveBeenCalled();
    expect(candidateRepo.createCandidate).not.toHaveBeenCalled();
    expect(result.every((entry) => entry.status === "ineligible")).toBe(true);
  });

  it("reports an approve with a missing required asset as ineligible while approving the rest", async () => {
    (packRepo.listItemVersions as jest.Mock).mockImplementation(
      (_packId, itemId) => {
        if (itemId === "item-2") {
          return Promise.resolve([
            { ...VERSION_2B_ROW, assetRequired: true, assetIds: ["asset-1"] },
          ]);
        }
        if (itemId === "item-1") return Promise.resolve([ITEM_VERSION_ROW]);
        return Promise.resolve([VERSION_2C_ROW]);
      },
    );
    (decisionRepo.bulkRecordDecisions as jest.Mock).mockResolvedValue({
      decisions: bulkDecisionsFor(["item-1", "item-3"]),
      errors: [],
    });

    const result = await service.bulkDecide("pack-1", BULK_DTO, OWNER_ID);

    expect(decisionRepo.bulkRecordDecisions).toHaveBeenCalledWith(
      [
        expect.objectContaining({ itemId: "item-1" }),
        expect.objectContaining({ itemId: "item-3" }),
      ],
      OWNER_ID,
      expect.anything(),
    );
    expect(result.find((entry) => entry.item_id === "item-2")).toEqual({
      item_id: "item-2",
      status: "ineligible",
      error: { code: "CONTENT_ASSET_REQUIRED", message: expect.any(String) },
    });
    expect(result.find((entry) => entry.item_id === "item-1")?.status).toBe(
      "approved",
    );
  });

  it("records a rejected decision without creating a candidate", async () => {
    (decisionRepo.bulkRecordDecisions as jest.Mock).mockResolvedValue({
      decisions: [
        { ...DECISION_ROW, id: "decision-rej", decision: "rejected" as const },
      ],
      errors: [],
    });

    const result = await service.bulkDecide(
      "pack-1",
      [
        {
          ...BULK_DTO[0],
          decision: "rejected",
          idempotency_key: "bulk-idem-rej",
        },
      ],
      OWNER_ID,
    );

    expect(candidateRepo.createCandidate).not.toHaveBeenCalled();
    expect(candidateRepo.getCandidateByItemVersionId).not.toHaveBeenCalled();
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ item_id: "item-1", status: "rejected" });
  });

  it("persists a durable revision intent before enqueueing a bulk revision", async () => {
    const request: ContentDecisionRequest = {
      ...BULK_DTO[0],
      decision: "revision_requested",
      revision_notes: "Use the approved offer wording.",
    };
    (decisionRepo.bulkRecordDecisions as jest.Mock).mockResolvedValue({
      decisions: [
        {
          ...DECISION_ROW,
          decision: "revision_requested",
          idempotencyKey: request.idempotency_key,
          revisionNotes: request.revision_notes,
        },
      ],
      errors: [],
    });

    const result = await service.bulkDecide("pack-1", [request], OWNER_ID);

    expect(result).toEqual([
      { item_id: "item-1", status: "revision_requested" },
    ]);
    expect(jobOutbox.createIntent).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: `revise-content:${request.idempotency_key}`,
        queueName: "content-generation",
        jobName: "revise-content",
        payload: expect.objectContaining({
          contentItemId: "item-1",
          idempotencyKey: request.idempotency_key,
        }),
      }),
      expect.anything(),
    );
    expect(generationQueue.add).toHaveBeenCalledWith(
      "revise-content",
      expect.objectContaining({
        contentItemId: "item-1",
        idempotencyKey: request.idempotency_key,
      }),
      expect.objectContaining({
        jobId: `revise-content-${request.idempotency_key}`,
      }),
    );
    expect(jobOutbox.markDirectDispatched).toHaveBeenCalledWith(
      `revise-content:${request.idempotency_key}`,
    );
  });

  it("keeps a bulk revision intent pending when Redis enqueue fails", async () => {
    const request: ContentDecisionRequest = {
      ...BULK_DTO[0],
      decision: "revision_requested",
      revision_notes: "Rework the opening line.",
    };
    (decisionRepo.bulkRecordDecisions as jest.Mock).mockResolvedValue({
      decisions: [
        {
          ...DECISION_ROW,
          decision: "revision_requested",
          idempotencyKey: request.idempotency_key,
          revisionNotes: request.revision_notes,
        },
      ],
      errors: [],
    });
    generationQueue.add.mockRejectedValue(new Error("Redis unavailable"));

    await expect(
      service.bulkDecide("pack-1", [request], OWNER_ID),
    ).rejects.toThrow("Redis unavailable");

    expect(jobOutbox.createIntent).toHaveBeenCalled();
    expect(jobOutbox.markDirectDispatched).not.toHaveBeenCalled();
  });
});

describe("ContentService.pauseCycle", () => {
  let service: ContentService;
  let cycleRepo: MockedCycleRepo;

  beforeEach(async () => {
    cycleRepo = makeCycleRepo();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContentService,
        { provide: StrategyRepository, useValue: makeStrategyRepo() },
        { provide: ContentCycleRepository, useValue: cycleRepo },
        { provide: ContentWeekContextRepository, useValue: makeWeekRepo() },
        { provide: ContentPackRepository, useValue: makePackRepo() },
        {
          provide: getQueueToken("content-generation"),
          useValue: { add: jest.fn() },
        },
        {
          provide: getQueueToken("content-outbox"),
          useValue: { add: jest.fn() },
        },
        { provide: ContentDecisionRepository, useValue: makeDecisionRepo() },
        {
          provide: PublicationCandidateRepository,
          useValue: makeCandidateRepo(),
        },
        { provide: PrismaService, useValue: makePrismaService() },
        { provide: CONTENT_ASSET_STORAGE, useValue: makeAssetStorage() },
      ],
    }).compile();

    service = module.get<ContentService>(ContentService);
  });

  it("throws NotFound when the cycle does not exist or is not owned by the caller", async () => {
    (cycleRepo.getCycleByIdAndOwner as jest.Mock).mockResolvedValue(null);

    await expect(
      service.pauseCycle("cycle-1", OWNER_ID, "holiday"),
    ).rejects.toThrow(NotFoundException);
  });

  it("persists the pause reason and returns the paused cycle", async () => {
    (cycleRepo.pauseCycle as jest.Mock).mockResolvedValue({
      ...CYCLE_ROW,
      status: "paused",
      pauseReason: "holiday",
    });

    const result = await service.pauseCycle("cycle-1", OWNER_ID, "holiday");

    expect(cycleRepo.pauseCycle).toHaveBeenCalledWith(
      "cycle-1",
      OWNER_ID,
      "holiday",
    );
    expect(result.status).toBe("paused");
    expect(result.pause_reason).toBe("holiday");
  });
});

describe("ContentService.resumeCycle", () => {
  let service: ContentService;
  let cycleRepo: MockedCycleRepo;

  beforeEach(async () => {
    cycleRepo = makeCycleRepo();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContentService,
        { provide: StrategyRepository, useValue: makeStrategyRepo() },
        { provide: ContentCycleRepository, useValue: cycleRepo },
        { provide: ContentWeekContextRepository, useValue: makeWeekRepo() },
        { provide: ContentPackRepository, useValue: makePackRepo() },
        {
          provide: getQueueToken("content-generation"),
          useValue: { add: jest.fn() },
        },
        {
          provide: getQueueToken("content-outbox"),
          useValue: { add: jest.fn() },
        },
        { provide: ContentDecisionRepository, useValue: makeDecisionRepo() },
        {
          provide: PublicationCandidateRepository,
          useValue: makeCandidateRepo(),
        },
        { provide: PrismaService, useValue: makePrismaService() },
        { provide: CONTENT_ASSET_STORAGE, useValue: makeAssetStorage() },
      ],
    }).compile();

    service = module.get<ContentService>(ContentService);
  });

  it("throws NotFound when the cycle does not exist or is not owned by the caller", async () => {
    (cycleRepo.getCycleByIdAndOwner as jest.Mock).mockResolvedValue(null);

    await expect(service.resumeCycle("cycle-1", OWNER_ID)).rejects.toThrow(
      NotFoundException,
    );
  });

  it("resumes the cycle and returns it with a null pause reason", async () => {
    (cycleRepo.resumeCycle as jest.Mock).mockResolvedValue({
      ...CYCLE_ROW,
      status: "active",
      pauseReason: null,
    });

    const result = await service.resumeCycle("cycle-1", OWNER_ID);

    expect(cycleRepo.resumeCycle).toHaveBeenCalledWith("cycle-1", OWNER_ID);
    expect(result.status).toBe("active");
    expect(result.pause_reason).toBeNull();
  });
});

describe("ContentService.retryPack", () => {
  let service: ContentService;
  let packRepo: MockedPackRepo;
  let queue: { add: jest.Mock };
  let jobOutbox: {
    createIntent: jest.Mock;
    markDirectDispatched: jest.Mock;
  };

  const FAILED_PACK_ROW = {
    ...PACK_ROW,
    status: "failed",
    retryEligible: true,
  };

  beforeEach(async () => {
    packRepo = makePackRepo({
      getPackByIdAndOwner: jest.fn().mockResolvedValue(FAILED_PACK_ROW),
      markPackStatus: jest.fn().mockResolvedValue({ changed: true }),
    });
    queue = { add: jest.fn().mockResolvedValue({ id: "job-1" }) };
    jobOutbox = {
      createIntent: jest.fn().mockResolvedValue({}),
      markDirectDispatched: jest.fn().mockResolvedValue(true),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContentService,
        { provide: StrategyRepository, useValue: makeStrategyRepo() },
        { provide: ContentCycleRepository, useValue: makeCycleRepo() },
        { provide: ContentWeekContextRepository, useValue: makeWeekRepo() },
        { provide: ContentPackRepository, useValue: packRepo },
        { provide: getQueueToken("content-generation"), useValue: queue },
        {
          provide: getQueueToken("content-outbox"),
          useValue: { add: jest.fn() },
        },
        { provide: ContentDecisionRepository, useValue: makeDecisionRepo() },
        {
          provide: PublicationCandidateRepository,
          useValue: makeCandidateRepo(),
        },
        { provide: PrismaService, useValue: makePrismaService() },
        { provide: CONTENT_ASSET_STORAGE, useValue: makeAssetStorage() },
        { provide: ContentJobOutboxRepository, useValue: jobOutbox },
      ],
    }).compile();

    service = module.get<ContentService>(ContentService);
  });

  it("throws NotFound when the pack does not exist or is not owned by the caller", async () => {
    (packRepo.getPackByIdAndOwner as jest.Mock).mockResolvedValue(null);

    await expect(service.retryPack("pack-1", OWNER_ID)).rejects.toThrow(
      NotFoundException,
    );
  });

  it("rejects with CONTENT_PACK_NOT_FAILED when the pack is not in the failed state", async () => {
    (packRepo.getPackByIdAndOwner as jest.Mock).mockResolvedValue(PACK_ROW);

    await rejectsWithCode(
      service.retryPack("pack-1", OWNER_ID),
      "CONTENT_PACK_NOT_FAILED",
    );
  });

  it("rejects with CONTENT_RETRY_NOT_ALLOWED when the pack is not retry-eligible", async () => {
    (packRepo.getPackByIdAndOwner as jest.Mock).mockResolvedValue({
      ...FAILED_PACK_ROW,
      retryEligible: false,
    });

    await rejectsWithCode(
      service.retryPack("pack-1", OWNER_ID),
      "CONTENT_RETRY_NOT_ALLOWED",
    );
  });

  it("rejects with CONTENT_PACK_RETRY_CONFLICT when the conditional transition does not change a row", async () => {
    (packRepo.markPackStatus as jest.Mock).mockResolvedValue({
      changed: false,
    });

    await rejectsWithCode(
      service.retryPack("pack-1", OWNER_ID),
      "CONTENT_PACK_RETRY_CONFLICT",
    );
    expect(queue.add).not.toHaveBeenCalled();
  });

  it("re-queues the pack, transitions it to queued, and reports the correlation id", async () => {
    const result = await service.retryPack("pack-1", OWNER_ID);

    expect(packRepo.markPackStatus).toHaveBeenCalledWith(
      "pack-1",
      "failed",
      "queued",
      expect.anything(),
    );
    expect(queue.add).toHaveBeenCalledWith(
      "generate-content",
      expect.objectContaining({
        contentCycleId: "cycle-1",
        weekNumber: 1,
        contentPackId: "pack-1",
        correlationId: expect.any(String),
      }),
      expect.objectContaining({ attempts: 3, jobId: expect.any(String) }),
    );
    expect(jobOutbox.createIntent).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: expect.stringContaining("generate-content:retry:pack-1:"),
        queueName: "content-generation",
        jobName: "generate-content",
        payload: expect.objectContaining({
          contentPackId: "pack-1",
          idempotencyKey: expect.stringMatching(/^retry:/),
        }),
      }),
      expect.anything(),
    );
    expect(jobOutbox.markDirectDispatched).toHaveBeenCalledWith(
      expect.stringContaining("generate-content:retry:pack-1:"),
    );
    expect(packRepo.appendProgressEvent).toHaveBeenCalledWith(
      "pack-1",
      expect.objectContaining({
        stage: "queued",
        status: "started",
        messageKey: "content.retry.queued",
      }),
    );
    expect(result.status).toBe("queued");
    expect(result.correlation_id).toEqual(expect.any(String));
    expect(result.content_pack.id).toBe("pack-1");
  });

  it("keeps the durable retry intent when Redis enqueue fails", async () => {
    queue.add.mockRejectedValue(new Error("Redis unavailable"));

    await expect(service.retryPack("pack-1", OWNER_ID)).rejects.toThrow(
      "Redis unavailable",
    );

    expect(jobOutbox.createIntent).toHaveBeenCalledWith(
      expect.objectContaining({ jobName: "generate-content" }),
      expect.anything(),
    );
    expect(jobOutbox.markDirectDispatched).not.toHaveBeenCalled();
  });
});

describe("planSelectedChannels (consolidated Strategy read)", () => {
  it("carries every supported channel from a strategy-v1 scorecard", () => {
    const channels = planSelectedChannels({
      contract_version: "strategy-v1",
      selected_channels: [
        { channel: "facebook" },
        { channel: "tiktok" },
        { channel: "google_business_profile" },
      ],
    });
    expect(channels).toEqual([
      "facebook",
      "tiktok",
      "google_business_profile",
    ]);
  });

  it("reads strategy-v2 plans from the deterministic content handoff", () => {
    const channels = planSelectedChannels({
      contract_version: "strategy-v2",
      content_handoff: {
        available: true,
        channels: ["facebook", "instagram", "google_business_profile"],
        language: "ar-EG",
        weeks: [],
      },
    });
    expect(channels).toEqual([
      "facebook",
      "instagram",
      "google_business_profile",
    ]);
  });

  it("returns [] for owner-managed v2 plans with an unavailable handoff", () => {
    expect(
      planSelectedChannels({
        contract_version: "strategy-v2",
        content_handoff: {
          available: false,
          reason: "no_content_supported_channels",
          message: "owner-managed plan",
        },
      }),
    ).toEqual([]);
  });

  it("returns [] on malformed input instead of throwing", () => {
    expect(planSelectedChannels({})).toEqual([]);
    expect(planSelectedChannels(null)).toEqual([]);
    expect(planSelectedChannels({ contract_version: "strategy-v2" })).toEqual(
      [],
    );
  });
});
