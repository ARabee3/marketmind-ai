import { Test, TestingModule } from "@nestjs/testing";
import {
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { getQueueToken } from "@nestjs/bullmq";
import { ContentService } from "./content.service";
import { ContentCycleRepository } from "./repositories/content-cycle.repository";
import { ContentWeekContextRepository } from "./repositories/content-week-context.repository";
import { ContentPackRepository } from "./repositories/content-pack.repository";
import { ContentDecisionRepository } from "./repositories/content-decision.repository";
import type { ContentDecisionRow } from "./repositories/content-decision.repository";
import { PublicationCandidateRepository } from "./repositories/publication-candidate.repository";
import { StrategyRepository } from "../strategy/strategy.repository";
import { PrismaService } from "../../common/persistence/prisma.service";
import { AssetStorage, CONTENT_ASSET_STORAGE } from "./assets/asset-storage.port";
import type { ContentDecisionRequest } from "@marketmind/contracts";

const OWNER_ID = "user-1";

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
  status: "draft",
  retryEligible: true,
  itemIds: ["item-1", "item-2"],
  createdAt: new Date("2026-08-01T00:00:00.000Z"),
  updatedAt: new Date("2026-08-01T00:00:00.000Z"),
};

const ITEM_ROW = {
  id: "item-1",
  contentPackId: "pack-1",
  status: "draft",
  currentVersionId: "ver-2",
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
  claimSources: [{ claim_type: "price", source_type: "business", approved: true }],
  warnings: [],
  blockers: [],
  assetRequired: false,
  assetIds: [],
  generationProvenance: { provider: "mock", model: "mock" },
  versionChecksum: "checksum-2",
  createdAt: new Date("2026-08-01T00:30:00.000Z"),
};

const REVISION_DECISION_ROW: ContentDecisionRow = {
  id: "decision-rev-1",
  contentItemId: "item-1",
  contentItemVersionId: "ver-2",
  contentItemVersion: 2,
  contentItemVersionChecksum: "checksum-2",
  decision: "revision_requested",
  revisionNotes: "Tighten the headline.",
  decidedByUserId: OWNER_ID,
  decidedAt: new Date("2026-08-01T01:00:00.000Z"),
  ownerUserId: OWNER_ID,
  idempotencyKey: "rev-idem-1",
  createdAt: new Date("2026-08-01T01:00:00.000Z"),
};

const REVISION_DTO: ContentDecisionRequest = {
  content_item_id: "item-1",
  content_item_version_id: "ver-2",
  content_item_version_checksum: "checksum-2",
  decision: "revision_requested",
  revision_notes: "Tighten the headline.",
  idempotency_key: "rev-idem-1",
};

type MockedCycleRepo = jest.Mocked<Partial<ContentCycleRepository>>;
type MockedWeekRepo = jest.Mocked<Partial<ContentWeekContextRepository>>;
type MockedPackRepo = jest.Mocked<Partial<ContentPackRepository>>;
type MockedDecisionRepo = jest.Mocked<Partial<ContentDecisionRepository>>;
type MockedCandidateRepo = jest.Mocked<Partial<PublicationCandidateRepository>>;
type MockedStrategyRepo = jest.Mocked<Partial<StrategyRepository>>;

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

function makeCycleRepo(): MockedCycleRepo {
  return { getCycleByIdAndOwner: jest.fn().mockResolvedValue(CYCLE_ROW) };
}

function makeWeekRepo(): MockedWeekRepo {
  return { listWeeks: jest.fn().mockResolvedValue([WEEK_ROW]) };
}

function makePackRepo(): MockedPackRepo {
  return {
    getPackByIdAndOwner: jest.fn().mockResolvedValue(PACK_ROW),
    getItemById: jest.fn().mockResolvedValue(ITEM_ROW),
    listItemVersions: jest.fn().mockResolvedValue([ITEM_VERSION_ROW]),
    listAssetsForVersion: jest.fn().mockResolvedValue([]),
  };
}

function makeDecisionRepo(
  overrides: Partial<MockedDecisionRepo> = {},
): MockedDecisionRepo {
  return {
    recordDecision: jest.fn().mockResolvedValue(REVISION_DECISION_ROW),
    ...overrides,
  };
}

function makeCandidateRepo(): MockedCandidateRepo {
  return {
    getCandidateByItemVersionId: jest.fn().mockResolvedValue(null),
  };
}

function makePrismaService() {
  return {
    $transaction: jest.fn(async (callback: (tx: unknown) => unknown) =>
      callback({}),
    ),
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
  if (error instanceof ConflictException) {
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

describe("ContentService.requestRevision", () => {
  let service: ContentService;
  let packRepo: MockedPackRepo;
  let decisionRepo: MockedDecisionRepo;
  let queue: { add: jest.Mock };

  beforeEach(async () => {
    packRepo = makePackRepo();
    decisionRepo = makeDecisionRepo();
    queue = { add: jest.fn().mockResolvedValue({ id: "job-1" }) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContentService,
        { provide: StrategyRepository, useValue: makeStrategyRepo() },
        { provide: ContentCycleRepository, useValue: makeCycleRepo() },
        { provide: ContentWeekContextRepository, useValue: makeWeekRepo() },
        { provide: ContentPackRepository, useValue: packRepo },
        { provide: getQueueToken("content-generation"), useValue: queue },
        { provide: getQueueToken("content-outbox"), useValue: { add: jest.fn() } },
        { provide: ContentDecisionRepository, useValue: decisionRepo },
        { provide: PublicationCandidateRepository, useValue: makeCandidateRepo() },
        { provide: PrismaService, useValue: makePrismaService() },
        { provide: CONTENT_ASSET_STORAGE, useValue: makeAssetStorage() },
      ],
    }).compile();

    service = module.get<ContentService>(ContentService);
  });

  it("throws NotFound when the pack does not exist or is not owned by the caller", async () => {
    (packRepo.getPackByIdAndOwner as jest.Mock).mockResolvedValue(null);

    await expect(
      service.requestRevision("pack-1", "item-1", REVISION_DTO, OWNER_ID),
    ).rejects.toThrow(NotFoundException);
  });

  it("rejects with CONTENT_APPROVAL_BLOCKED when the pack is not draft or partially approved", async () => {
    (packRepo.getPackByIdAndOwner as jest.Mock).mockResolvedValue({
      ...PACK_ROW,
      status: "queued",
    });

    await rejectsWithCode(
      service.requestRevision("pack-1", "item-1", REVISION_DTO, OWNER_ID),
      "CONTENT_APPROVAL_BLOCKED",
    );
  });

  it("throws NotFound when the content item is missing", async () => {
    (packRepo.getItemById as jest.Mock).mockResolvedValue(null);

    await expect(
      service.requestRevision("pack-1", "item-1", REVISION_DTO, OWNER_ID),
    ).rejects.toThrow(NotFoundException);
  });

  it("rejects with CONTENT_VERSION_CONFLICT when the submitted version id is stale", async () => {
    await rejectsWithCode(
      service.requestRevision(
        "pack-1",
        "item-1",
        { ...REVISION_DTO, content_item_version_id: "ver-1" },
        OWNER_ID,
      ),
      "CONTENT_VERSION_CONFLICT",
    );
  });

  it("rejects with CONTENT_VERSION_CONFLICT when the submitted checksum mismatches", async () => {
    await rejectsWithCode(
      service.requestRevision(
        "pack-1",
        "item-1",
        { ...REVISION_DTO, content_item_version_checksum: "wrong" },
        OWNER_ID,
      ),
      "CONTENT_VERSION_CONFLICT",
    );
  });

  it("records the revision_requested decision against the exact current version", async () => {
    await service.requestRevision("pack-1", "item-1", REVISION_DTO, OWNER_ID);

    expect(decisionRepo.recordDecision).toHaveBeenCalledWith({
      itemId: "item-1",
      versionId: "ver-2",
      versionNumber: 2,
      versionChecksum: "checksum-2",
      decision: "revision_requested",
      revisionNotes: "Tighten the headline.",
      ownerUserId: OWNER_ID,
      idempotencyKey: "rev-idem-1",
    });
  });

  it("enqueues a revise-content job pointing at the base version with attempts 3", async () => {
    const result = await service.requestRevision("pack-1", "item-1", REVISION_DTO, OWNER_ID);

    expect(queue.add).toHaveBeenCalledTimes(1);
    const [jobName, payload, options] = queue.add.mock.calls[0];
    expect(jobName).toBe("revise-content");
    expect(payload).toEqual(
      expect.objectContaining({
        contentCycleId: "cycle-1",
        contentPackId: "pack-1",
        contentItemId: "item-1",
        baseItemVersionId: "ver-2",
        revisionNotes: "Tighten the headline.",
        idempotencyKey: "rev-idem-1",
        correlationId: expect.any(String),
      }),
    );
    expect(options).toEqual(
      expect.objectContaining({ attempts: 3, backoff: { type: "exponential", delay: 2000 } }),
    );

    // The base version is the reference the processor must preserve: the job
    // carries the exact current version id and the service never calls any
    // version-mutating repository method — the prior version row is left
    // untouched by construction (insert-only content_item_versions).
    expect(result.correlation_id).toEqual(expect.any(String));
    expect(result.decision.decision).toBe("revision_requested");
    expect(packRepo.listItemVersions).toHaveBeenCalledWith("pack-1", "item-1");
  });
});

describe("ContentService.decide (revision_requested)", () => {
  let service: ContentService;
  let queue: { add: jest.Mock };

  beforeEach(async () => {
    queue = { add: jest.fn().mockResolvedValue({ id: "job-1" }) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContentService,
        { provide: StrategyRepository, useValue: makeStrategyRepo() },
        { provide: ContentCycleRepository, useValue: makeCycleRepo() },
        { provide: ContentWeekContextRepository, useValue: makeWeekRepo() },
        { provide: ContentPackRepository, useValue: makePackRepo() },
        { provide: getQueueToken("content-generation"), useValue: queue },
        { provide: getQueueToken("content-outbox"), useValue: { add: jest.fn() } },
        { provide: ContentDecisionRepository, useValue: makeDecisionRepo() },
        { provide: PublicationCandidateRepository, useValue: makeCandidateRepo() },
        { provide: PrismaService, useValue: makePrismaService() },
        { provide: CONTENT_ASSET_STORAGE, useValue: makeAssetStorage() },
      ],
    }).compile();

    service = module.get<ContentService>(ContentService);
  });

  it("routes revision_requested through requestRevision and returns no candidate", async () => {
    const result = await service.decide("pack-1", "item-1", REVISION_DTO, OWNER_ID);

    expect(queue.add).toHaveBeenCalledWith(
      "revise-content",
      expect.objectContaining({ contentItemId: "item-1" }),
      expect.anything(),
    );
    expect(result.publication_candidate).toBeNull();
    expect(result.decision.decision).toBe("revision_requested");
  });
});

describe("ContentService.bulkDecide (revision_requested)", () => {
  let service: ContentService;
  let packRepo: MockedPackRepo;
  let decisionRepo: MockedDecisionRepo;
  let queue: { add: jest.Mock };

  beforeEach(async () => {
    packRepo = makePackRepo();
    decisionRepo = makeDecisionRepo({
      bulkRecordDecisions: jest.fn().mockResolvedValue({
        decisions: [REVISION_DECISION_ROW],
        errors: [],
      }),
    });
    queue = { add: jest.fn().mockResolvedValue({ id: "job-1" }) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContentService,
        { provide: StrategyRepository, useValue: makeStrategyRepo() },
        { provide: ContentCycleRepository, useValue: makeCycleRepo() },
        { provide: ContentWeekContextRepository, useValue: makeWeekRepo() },
        { provide: ContentPackRepository, useValue: packRepo },
        { provide: getQueueToken("content-generation"), useValue: queue },
        { provide: getQueueToken("content-outbox"), useValue: { add: jest.fn() } },
        { provide: ContentDecisionRepository, useValue: decisionRepo },
        { provide: PublicationCandidateRepository, useValue: makeCandidateRepo() },
        { provide: PrismaService, useValue: makePrismaService() },
        { provide: CONTENT_ASSET_STORAGE, useValue: makeAssetStorage() },
      ],
    }).compile();

    service = module.get<ContentService>(ContentService);
  });

  it("enqueues a revise-content job for each recorded revision_requested decision", async () => {
    const result = await service.bulkDecide("pack-1", [REVISION_DTO], OWNER_ID);

    expect(queue.add).toHaveBeenCalledWith(
      "revise-content",
      expect.objectContaining({
        contentCycleId: "cycle-1",
        contentPackId: "pack-1",
        contentItemId: "item-1",
        baseItemVersionId: "ver-2",
        idempotencyKey: "rev-idem-1",
        correlationId: expect.any(String),
      }),
      expect.objectContaining({ attempts: 3 }),
    );
    expect(result).toEqual([{ item_id: "item-1", status: "revision_requested" }]);
  });

  it("does not enqueue revise jobs when no decision was revision_requested", async () => {
    (decisionRepo.bulkRecordDecisions as jest.Mock).mockResolvedValue({
      decisions: [{ ...REVISION_DECISION_ROW, decision: "rejected" as const }],
      errors: [],
    });

    await service.bulkDecide(
      "pack-1",
      [{ ...REVISION_DTO, decision: "rejected" }],
      OWNER_ID,
    );

    expect(queue.add).not.toHaveBeenCalled();
  });
});
