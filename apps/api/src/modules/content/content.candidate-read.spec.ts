import { Test, TestingModule } from "@nestjs/testing";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { getQueueToken } from "@nestjs/bullmq";
import { computePublicationCandidateChecksum } from "@marketmind/contracts";
import type {
  PublicationCandidateStatusV1,
  PublicationCandidateV1,
} from "@marketmind/contracts";
import { ContentService } from "./content.service";
import { ContentCycleRepository } from "./repositories/content-cycle.repository";
import { ContentWeekContextRepository } from "./repositories/content-week-context.repository";
import { ContentPackRepository } from "./repositories/content-pack.repository";
import { ContentDecisionRepository } from "./repositories/content-decision.repository";
import { PublicationCandidateRepository } from "./repositories/publication-candidate.repository";
import { StrategyRepository } from "../strategy/strategy.repository";
import { PrismaService } from "../../common/persistence/prisma.service";
import { AssetStorage, CONTENT_ASSET_STORAGE } from "./assets/asset-storage.port";

const OWNER_ID = "user-1";

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
  assets: [
    {
      asset_id: "asset-1",
      kind: "generated_static",
      mime_type: "image/png",
      storage_key: "ver-2/asset-1.png",
      checksum: "a".repeat(64),
    },
  ],
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

const ACTIVE_STATUS: PublicationCandidateStatusV1 = {
  contract_version: "publication-candidate-status-v1",
  candidate_id: CANDIDATE.candidate_id,
  business_id: CANDIDATE.business_id,
  candidate_checksum: CANDIDATE.candidate_checksum,
  state_version: 1,
  candidate_state: "active",
  replacement_candidate_id: null,
  changed_by_user_id: OWNER_ID,
  changed_at: CANDIDATE.created_at,
};

type MockedCandidateRepo = jest.Mocked<Partial<PublicationCandidateRepository>>;

function makeCandidateRepo(
  overrides: Partial<MockedCandidateRepo> = {},
): MockedCandidateRepo {
  return {
    getCandidateByIdAndOwner: jest
      .fn()
      .mockResolvedValue({ candidate: CANDIDATE, status: ACTIVE_STATUS }),
    ...overrides,
  };
}

function makePrismaService() {
  return {
    $transaction: jest.fn(async (callback: (tx: unknown) => unknown) =>
      callback({}),
    ),
  };
}

/** Extracts the `code` from a Nest HttpException response body. */
function errorCode(error: unknown): string | undefined {
  if (error instanceof BadRequestException) {
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

describe("ContentService.getPublicationCandidate", () => {
  let service: ContentService;
  let candidateRepo: MockedCandidateRepo;

  beforeEach(async () => {
    candidateRepo = makeCandidateRepo();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContentService,
        { provide: StrategyRepository, useValue: { getStrategyByIdAndOwner: jest.fn() } },
        { provide: ContentCycleRepository, useValue: { getCycleByIdAndOwner: jest.fn() } },
        { provide: ContentWeekContextRepository, useValue: { listWeeks: jest.fn() } },
        { provide: ContentPackRepository, useValue: { getAssetByIdAndOwner: jest.fn() } },
        { provide: getQueueToken("content-generation"), useValue: { add: jest.fn() } },
        { provide: ContentDecisionRepository, useValue: { recordDecision: jest.fn() } },
        { provide: PublicationCandidateRepository, useValue: candidateRepo },
        { provide: PrismaService, useValue: makePrismaService() },
        { provide: CONTENT_ASSET_STORAGE, useValue: {} as AssetStorage },
      ],
    }).compile();

    service = module.get<ContentService>(ContentService);
  });

  it("returns 404 when the candidate does not belong to the owner", async () => {
    (candidateRepo.getCandidateByIdAndOwner as jest.Mock).mockResolvedValue(null);

    await expect(
      service.getPublicationCandidate("candidate-1", OWNER_ID),
    ).rejects.toThrow(NotFoundException);
  });

  it("returns the immutable payload and current status for an active candidate", async () => {
    const result = await service.getPublicationCandidate("candidate-1", OWNER_ID);

    expect(result.candidate).toEqual(CANDIDATE);
    expect(result.status).toEqual(ACTIVE_STATUS);
    expect(candidateRepo.getCandidateByIdAndOwner).toHaveBeenCalledWith(
      "candidate-1",
      OWNER_ID,
    );
  });

  it("rejects a revoked candidate with CONTENT_CANDIDATE_REVOKED", async () => {
    (candidateRepo.getCandidateByIdAndOwner as jest.Mock).mockResolvedValue({
      candidate: CANDIDATE,
      status: {
        ...ACTIVE_STATUS,
        candidate_state: "revoked",
        replacement_candidate_id: null,
      },
    });

    await rejectsWithCode(
      service.getPublicationCandidate("candidate-1", OWNER_ID),
      "CONTENT_CANDIDATE_REVOKED",
    );
  });

  it("rejects a tampered payload with CONTENT_CANDIDATE_TAMPERED", async () => {
    (candidateRepo.getCandidateByIdAndOwner as jest.Mock).mockResolvedValue({
      candidate: { ...CANDIDATE, caption: "mutated-in-db" },
      status: ACTIVE_STATUS,
    });

    await rejectsWithCode(
      service.getPublicationCandidate("candidate-1", OWNER_ID),
      "CONTENT_CANDIDATE_TAMPERED",
    );
  });

  it("rejects a payload whose checksum field was rewritten with CONTENT_CANDIDATE_TAMPERED", async () => {
    (candidateRepo.getCandidateByIdAndOwner as jest.Mock).mockResolvedValue({
      candidate: { ...CANDIDATE, candidate_checksum: "f".repeat(64) },
      status: ACTIVE_STATUS,
    });

    await rejectsWithCode(
      service.getPublicationCandidate("candidate-1", OWNER_ID),
      "CONTENT_CANDIDATE_TAMPERED",
    );
  });
});
