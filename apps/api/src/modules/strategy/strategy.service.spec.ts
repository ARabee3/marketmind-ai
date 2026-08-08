import { Test, TestingModule } from "@nestjs/testing";
import { StrategyService } from "./strategy.service";
import { StrategyRepository } from "./strategy.repository";
import { getQueueToken } from "@nestjs/bullmq";
import { HttpService } from "@nestjs/axios";
import { ConfigService } from "@nestjs/config";
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  InternalServerErrorException,
} from "@nestjs/common";
import { of, throwError } from "rxjs";
import { StrategyProgressGateway } from "./strategy-progress.gateway";

const OWNER_ID = "user-1";
const OTHER_OWNER_ID = "user-2";
const STRAT_ID = "strat-1";

const PROFILE_VERSION_FIXTURE = {
  id: "prof-1",
  businessId: "biz-1",
  draftId: "draft-1",
  version: 1,
  confirmedByUserId: OWNER_ID,
  confirmedAt: new Date("2026-01-10T00:00:00.000Z"),
  createdAt: new Date("2026-01-10T00:00:00.000Z"),
  profile: {
    business_type: "dessert shop",
    primary_locale: "ar-EG",
    confirmed_facts: {
      current_marketing: {
        active_channels: ["instagram"],
        available_assets: ["submitted Instagram page"],
      },
    },
  },
};

const STRATEGY_FIXTURE = {
  id: STRAT_ID,
  status: "ready",
  businessId: "biz-1",
  brief: { id: "brief-1", businessProfileVersionId: "prof-1" },
  business: {
    id: "biz-1",
    businessType: "dessert shop",
    primaryLocale: "ar-EG",
  },
};

type MockedRepo = jest.Mocked<Partial<StrategyRepository>>;

function makeRepository(overrides: Partial<MockedRepo> = {}): MockedRepo {
  return {
    getActiveConfirmedProfileVersion: jest.fn(),
    getConfirmedProfileVersionByIdAndOwner: jest.fn(),
    createStrategy: jest.fn(),
    getStrategyByIdAndOwner: jest.fn(),
    upsertBrief: jest.fn(),
    updateStrategyStatus: jest.fn().mockResolvedValue({}),
    getLatestRetrievalRun: jest.fn(),
    getLatestVersion: jest.fn(),
    getVersionByNumber: jest.fn(),
    getVersionById: jest.fn().mockResolvedValue({
      id: "v-1",
      strategyId: STRAT_ID,
      retrievalRunId: "run-1",
      planData: {
        blockers: [],
        citations: [
          {
            chunk_id: "chunk-1",
            entry_id: "entry-1",
            entry_version: 1,
          },
        ],
      },
    }),
    getLatestProgressEvent: jest.fn().mockResolvedValue({
      status: "failed",
      payload: { retryable: true },
    }),
    countRetries: jest.fn().mockResolvedValue(0),
    recordRetryDecision: jest.fn(),
    recordOwnerDecision: jest.fn(),
    claimForGeneration: jest.fn(),
    appendProgressEvent: jest.fn().mockResolvedValue({}),
    listProgressEvents: jest.fn(),
    listVersions: jest.fn(),
    listRetrievalRunBriefIds: jest.fn(),
    ...overrides,
  };
}

describe("StrategyService", () => {
  let service: StrategyService;
  let repository: MockedRepo;
  let queue: { add: jest.Mock };
  let httpService: { post: jest.Mock };

  beforeEach(async () => {
    repository = makeRepository();
    queue = { add: jest.fn() };
    httpService = { post: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StrategyService,
        { provide: StrategyRepository, useValue: repository },
        { provide: getQueueToken("strategy-generation"), useValue: queue },
        { provide: HttpService, useValue: httpService },
        {
          provide: StrategyProgressGateway,
          useValue: { emitProgress: jest.fn() },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) =>
              key === "aiService.url" ? "http://localhost:8000" : 30_000,
            ),
          },
        },
      ],
    }).compile();

    service = module.get<StrategyService>(StrategyService);
  });

  // ── createStrategy ──────────────────────────────────────────────────

  describe("createStrategy", () => {
    it("rejects when no confirmed business profile exists", async () => {
      (
        repository.getConfirmedProfileVersionByIdAndOwner as jest.Mock
      ).mockResolvedValue(null);

      await expect(
        service.createStrategy(
          { businessProfileVersionId: "prof-1" },
          OWNER_ID,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("creates the strategy when a confirmed profile exists", async () => {
      (
        repository.getConfirmedProfileVersionByIdAndOwner as jest.Mock
      ).mockResolvedValue({
        id: "prof-1",
        businessId: "biz-1",
      });
      (repository.createStrategy as jest.Mock).mockResolvedValue({
        id: STRAT_ID,
      });

      const result = await service.createStrategy(
        { businessProfileVersionId: "prof-1" },
        OWNER_ID,
      );

      expect(result).toEqual({ id: STRAT_ID });
      expect(
        repository.getConfirmedProfileVersionByIdAndOwner,
      ).toHaveBeenCalledWith("prof-1", OWNER_ID);
      expect(repository.createStrategy).toHaveBeenCalledWith("biz-1", OWNER_ID);
    });
  });

  describe("upsertBrief", () => {
    const validBrief = {
      businessProfileVersionId: "prof-1",
      primaryObjective: "conversion",
      startDate: "2026-08-01",
      planLanguage: "en",
      paidMediaAllowed: false,
      externalBudgetMode: "organic_only",
      teamCapacity: "Owner plus one helper",
      constraints: "",
      clarificationAnswers: [],
    } as never;

    it("locks the provenance-bearing brief after generation starts", async () => {
      (repository.getStrategyByIdAndOwner as jest.Mock).mockResolvedValue({
        id: STRAT_ID,
        status: "draft",
        businessId: "biz-1",
      });

      await expect(
        service.upsertBrief(STRAT_ID, OWNER_ID, validBrief),
      ).rejects.toThrow(ConflictException);

      expect(repository.upsertBrief).not.toHaveBeenCalled();
    });

    it("rejects a confirmed profile from another business", async () => {
      (repository.getStrategyByIdAndOwner as jest.Mock).mockResolvedValue({
        id: STRAT_ID,
        status: "needs_brief",
        businessId: "biz-1",
      });
      (
        repository.getConfirmedProfileVersionByIdAndOwner as jest.Mock
      ).mockResolvedValue({
        id: "prof-1",
        businessId: "biz-2",
      });

      await expect(
        service.upsertBrief(STRAT_ID, OWNER_ID, validBrief),
      ).rejects.toThrow(BadRequestException);

      expect(repository.upsertBrief).not.toHaveBeenCalled();
    });

    it("persists a ready brief against the Strategy business profile", async () => {
      (repository.getStrategyByIdAndOwner as jest.Mock).mockResolvedValue({
        id: STRAT_ID,
        status: "needs_brief",
        businessId: "biz-1",
      });
      (
        repository.getConfirmedProfileVersionByIdAndOwner as jest.Mock
      ).mockResolvedValue({
        id: "prof-1",
        businessId: "biz-1",
      });
      (repository.upsertBrief as jest.Mock).mockResolvedValue({
        id: "brief-1",
        primaryObjective: "conversion",
        startDate: new Date("2026-08-01"),
        planLanguage: "en",
        paidMediaAllowed: false,
        externalBudgetMode: "organic_only",
        teamCapacity: "Owner plus one helper",
      });

      await service.upsertBrief(STRAT_ID, OWNER_ID, validBrief);

      expect(repository.upsertBrief).toHaveBeenCalledTimes(1);
      expect(repository.updateStrategyStatus).toHaveBeenCalledWith(
        STRAT_ID,
        "ready",
      );
    });

    it("normalizes a date-only startDate into a full Date for Prisma", async () => {
      (repository.getStrategyByIdAndOwner as jest.Mock).mockResolvedValue({
        id: STRAT_ID,
        status: "needs_brief",
        businessId: "biz-1",
      });
      (
        repository.getConfirmedProfileVersionByIdAndOwner as jest.Mock
      ).mockResolvedValue({
        id: "prof-1",
        businessId: "biz-1",
      });
      (repository.upsertBrief as jest.Mock).mockResolvedValue({
        id: "brief-1",
        primaryObjective: "conversion",
        startDate: new Date("2026-08-01"),
        planLanguage: "en",
        paidMediaAllowed: false,
        externalBudgetMode: "organic_only",
        teamCapacity: "Owner plus one helper",
      });

      await service.upsertBrief(STRAT_ID, OWNER_ID, validBrief);

      const args = (repository.upsertBrief as jest.Mock).mock.calls[0][1];
      expect(args.startDate).toBeInstanceOf(Date);
      expect((args.startDate as Date).toISOString()).toBe(
        "2026-08-01T00:00:00.000Z",
      );
    });

    // ── Owner-first strategy-v2 briefs (issue #135) ───────────────────

    const v2Strategy = {
      id: STRAT_ID,
      status: "needs_brief",
      businessId: "biz-1",
      contractVersion: "strategy-v2",
    };

    const v2Brief = {
      businessProfileVersionId: "prof-1",
      primaryObjective: "conversion",
      startDate: "2026-08-03",
      planLanguage: "ar-EG",
      paidMediaAllowed: false,
      externalBudgetMode: "organic_only",
      weeklyCapacity: "three_to_five_hours",
      channelChoices: [
        {
          channel: "facebook",
          role: "primary",
          setupState: "setup_later",
        },
        {
          channel: "instagram",
          role: "supporting",
          setupState: "existing_link",
          publicUrl: "https://instagram.com/kosharycorner",
        },
      ],
      constraints: "",
      clarificationAnswers: [],
    };

    function mockV2UpsertBase() {
      (repository.getStrategyByIdAndOwner as jest.Mock).mockResolvedValue(
        v2Strategy,
      );
      (
        repository.getConfirmedProfileVersionByIdAndOwner as jest.Mock
      ).mockResolvedValue({
        id: "prof-1",
        businessId: "biz-1",
      });
    }

    it("persists an owner-first v2 brief with snake_case channel choices", async () => {
      mockV2UpsertBase();
      (repository.upsertBrief as jest.Mock).mockResolvedValue({
        id: "brief-1",
        primaryObjective: "conversion",
        startDate: new Date("2026-08-03"),
        planLanguage: "ar-EG",
        paidMediaAllowed: false,
        externalBudgetMode: "organic_only",
        weeklyCapacity: "three_to_five_hours",
        channelChoices: v2Brief.channelChoices,
      });

      await service.upsertBrief(STRAT_ID, OWNER_ID, v2Brief as never);

      const args = (repository.upsertBrief as jest.Mock).mock.calls[0][1];
      expect(args.weeklyCapacity).toBe("three_to_five_hours");
      expect(args.channelChoices).toEqual([
        {
          channel: "facebook",
          role: "primary",
          setup_state: "setup_later",
        },
        {
          channel: "instagram",
          role: "supporting",
          setup_state: "existing_link",
          public_url: "https://instagram.com/kosharycorner",
        },
      ]);
      expect(repository.updateStrategyStatus).toHaveBeenCalledWith(
        STRAT_ID,
        "ready",
      );
    });

    it("rejects v2 briefs without a weekly capacity preset", async () => {
      mockV2UpsertBase();

      await expect(
        service.upsertBrief(STRAT_ID, OWNER_ID, {
          ...v2Brief,
          weeklyCapacity: undefined,
        } as never),
      ).rejects.toThrow(/weeklyCapacity/);

      expect(repository.upsertBrief).not.toHaveBeenCalled();
    });

    it("rejects v2 briefs with no channel choices", async () => {
      mockV2UpsertBase();

      await expect(
        service.upsertBrief(STRAT_ID, OWNER_ID, {
          ...v2Brief,
          channelChoices: [],
        } as never),
      ).rejects.toThrow(/1 to 3 channel choices/);

      expect(repository.upsertBrief).not.toHaveBeenCalled();
    });

    it("rejects v2 briefs with two primary channels", async () => {
      mockV2UpsertBase();

      await expect(
        service.upsertBrief(STRAT_ID, OWNER_ID, {
          ...v2Brief,
          channelChoices: [
            ...v2Brief.channelChoices,
            {
              channel: "google_business_profile",
              role: "primary",
              setupState: "setup_later",
            },
          ],
        } as never),
      ).rejects.toThrow(/Exactly one primary channel/);

      expect(repository.upsertBrief).not.toHaveBeenCalled();
    });

    it("rejects v2 briefs with a public URL on a setup_later choice", async () => {
      mockV2UpsertBase();

      await expect(
        service.upsertBrief(STRAT_ID, OWNER_ID, {
          ...v2Brief,
          channelChoices: [
            {
              channel: "facebook",
              role: "primary",
              setupState: "setup_later",
              publicUrl: "https://facebook.com/kosharycorner",
            },
          ],
        } as never),
      ).rejects.toThrow(/only allowed for an existing_link/);

      expect(repository.upsertBrief).not.toHaveBeenCalled();
    });

    it("keeps v1 briefs on the legacy path without channel choices", async () => {
      (repository.getStrategyByIdAndOwner as jest.Mock).mockResolvedValue({
        id: STRAT_ID,
        status: "needs_brief",
        businessId: "biz-1",
        contractVersion: "strategy-v1",
      });
      (
        repository.getConfirmedProfileVersionByIdAndOwner as jest.Mock
      ).mockResolvedValue({
        id: "prof-1",
        businessId: "biz-1",
      });
      (repository.upsertBrief as jest.Mock).mockResolvedValue({
        id: "brief-1",
        primaryObjective: "conversion",
        startDate: new Date("2026-08-01"),
        planLanguage: "en",
        paidMediaAllowed: false,
        externalBudgetMode: "organic_only",
        teamCapacity: "Owner plus one helper",
      });

      await service.upsertBrief(STRAT_ID, OWNER_ID, validBrief);

      const args = (repository.upsertBrief as jest.Mock).mock.calls[0][1];
      expect(args.weeklyCapacity).toBeUndefined();
      expect(args.channelChoices).toBeUndefined();
      expect(args.teamCapacity).toBe("Owner plus one helper");
    });

    it("rejects an invalid startDate with a friendly 400 instead of a Prisma error", async () => {
      (repository.getStrategyByIdAndOwner as jest.Mock).mockResolvedValue({
        id: STRAT_ID,
        status: "needs_brief",
        businessId: "biz-1",
      });
      (
        repository.getConfirmedProfileVersionByIdAndOwner as jest.Mock
      ).mockResolvedValue({
        id: "prof-1",
        businessId: "biz-1",
      });

      await expect(
        service.upsertBrief(STRAT_ID, OWNER_ID, {
          businessProfileVersionId: "prof-1",
          primaryObjective: "conversion",
          startDate: "not-a-date",
          planLanguage: "en",
          paidMediaAllowed: false,
          externalBudgetMode: "organic_only",
          teamCapacity: "Owner plus one helper",
          constraints: "",
          clarificationAnswers: [],
        } as never),
      ).rejects.toThrow(BadRequestException);

      expect(repository.upsertBrief).not.toHaveBeenCalled();
    });
  });

  // ── startGeneration: Atomic idempotency ─────────────────────────────

  describe("startGeneration — Atomic idempotency", () => {
    it("rejects when the atomic claim fails (already in progress)", async () => {
      (repository.getStrategyByIdAndOwner as jest.Mock).mockResolvedValue({
        id: STRAT_ID,
        status: "queued",
        businessId: "biz-1",
        brief: { businessProfileVersionId: "prof-1" },
      });
      // claimForGeneration returns claimed:false because status is "queued"
      (repository.claimForGeneration as jest.Mock).mockResolvedValue({
        claimed: false,
      });

      await expect(service.startGeneration(STRAT_ID, OWNER_ID)).rejects.toThrow(
        BadRequestException,
      );

      // No job enqueued, no provider call, no second claim.
      expect(queue.add).not.toHaveBeenCalled();
      expect(httpService.post).not.toHaveBeenCalled();
    });

    it("rejects when status is draft (not ready)", async () => {
      (repository.getStrategyByIdAndOwner as jest.Mock).mockResolvedValue({
        id: STRAT_ID,
        status: "draft",
        businessId: "biz-1",
        brief: { businessProfileVersionId: "prof-1" },
      });
      (repository.claimForGeneration as jest.Mock).mockResolvedValue({
        claimed: false,
      });

      await expect(service.startGeneration(STRAT_ID, OWNER_ID)).rejects.toThrow(
        BadRequestException,
      );
    });

    it("rejects when status is failed (startGeneration only accepts ready; use /retry)", async () => {
      (repository.getStrategyByIdAndOwner as jest.Mock).mockResolvedValue({
        id: STRAT_ID,
        status: "failed",
        businessId: "biz-1",
        brief: { businessProfileVersionId: "prof-1" },
      });
      (repository.claimForGeneration as jest.Mock).mockResolvedValue({
        claimed: false,
      });

      await expect(service.startGeneration(STRAT_ID, OWNER_ID)).rejects.toThrow(
        BadRequestException,
      );
    });

    it("enqueues exactly one job when the claim succeeds", async () => {
      (repository.getStrategyByIdAndOwner as jest.Mock).mockResolvedValue(
        STRATEGY_FIXTURE,
      );
      (repository.claimForGeneration as jest.Mock).mockResolvedValue({
        claimed: true,
      });
      (
        repository.getActiveConfirmedProfileVersion as jest.Mock
      ).mockResolvedValue(PROFILE_VERSION_FIXTURE);
      httpService.post.mockReturnValue(
        of({ data: { retrieval_run_id: "run-1" } }),
      );

      const result = await service.startGeneration(STRAT_ID, OWNER_ID);

      expect(result.status).toBe("queued");
      expect(queue.add).toHaveBeenCalledTimes(1);
      expect(queue.add).toHaveBeenCalledWith(
        "generate-strategy",
        expect.objectContaining({
          strategyId: STRAT_ID,
          retrievalRunId: "run-1",
        }),
        expect.any(Object),
      );
      const queuedStatusCall = (
        repository.updateStrategyStatus as jest.Mock
      ).mock.invocationCallOrder.find(
        (_callOrder: number, index: number) =>
          (repository.updateStrategyStatus as jest.Mock).mock.calls[index]?.[1] ===
          "queued",
      );
      const queueAddCall = queue.add.mock.invocationCallOrder[0];

      expect(queuedStatusCall).toBeLessThan(queueAddCall);
      expect(httpService.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          business_type: "dessert shop",
          industry: "dessert shop",
        }),
        expect.objectContaining({ timeout: 30_000 }),
      );
    });
  });

  // ── startGeneration: Stale-profile ──────────────────────────────────

  describe("startGeneration — Stale-profile detection", () => {
    it("rolls back to failed and blocks when the profile is outdated", async () => {
      (repository.getStrategyByIdAndOwner as jest.Mock).mockResolvedValue({
        id: STRAT_ID,
        status: "ready",
        businessId: "biz-1",
        brief: { businessProfileVersionId: "old-prof" },
      });
      (repository.claimForGeneration as jest.Mock).mockResolvedValue({
        claimed: true,
      });
      (
        repository.getActiveConfirmedProfileVersion as jest.Mock
      ).mockResolvedValue({
        id: "new-prof",
      });

      await expect(service.startGeneration(STRAT_ID, OWNER_ID)).rejects.toThrow(
        BadRequestException,
      );

      // Stale profile rolls the claim back to failed.
      expect(repository.updateStrategyStatus).toHaveBeenCalledWith(
        STRAT_ID,
        "failed",
      );
      // No provider generation call, no enqueue.
      expect(queue.add).not.toHaveBeenCalled();
      // A progress event with STALE_PROFILE was recorded.
      expect(repository.appendProgressEvent).toHaveBeenCalledWith(
        STRAT_ID,
        expect.objectContaining({
          messageKey: "strategy.stale_profile",
          payload: expect.objectContaining({ code: "STALE_PROFILE" }),
        }),
      );
    });
  });

  // ── startGeneration: Failure recovery ───────────────────────────────

  describe("startGeneration — Failure recovery", () => {
    it("transitions to failed and exposes retryable flag on 503", async () => {
      (repository.getStrategyByIdAndOwner as jest.Mock).mockResolvedValue(
        STRATEGY_FIXTURE,
      );
      (repository.claimForGeneration as jest.Mock).mockResolvedValue({
        claimed: true,
      });
      (
        repository.getActiveConfirmedProfileVersion as jest.Mock
      ).mockResolvedValue(PROFILE_VERSION_FIXTURE);
      httpService.post.mockReturnValue(
        throwError(() => ({
          response: { status: 503 },
          message: "Service Unavailable",
        })),
      );

      await expect(service.startGeneration(STRAT_ID, OWNER_ID)).rejects.toThrow(
        InternalServerErrorException,
      );

      expect(repository.updateStrategyStatus).toHaveBeenCalledWith(
        STRAT_ID,
        "failed",
      );
    });

    it("redacts provider error details from the surfaced message", async () => {
      (repository.getStrategyByIdAndOwner as jest.Mock).mockResolvedValue(
        STRATEGY_FIXTURE,
      );
      (repository.claimForGeneration as jest.Mock).mockResolvedValue({
        claimed: true,
      });
      (
        repository.getActiveConfirmedProfileVersion as jest.Mock
      ).mockResolvedValue(PROFILE_VERSION_FIXTURE);
      const providerError = {
        response: { status: 500, data: { internal_stack: "secret-trace" } },
        message: "Internal provider meltdown at /etc/secrets/key.pem",
      };
      httpService.post.mockReturnValue(throwError(() => providerError));

      let caught: unknown;
      try {
        await service.startGeneration(STRAT_ID, OWNER_ID);
      } catch (e) {
        caught = e;
      }

      expect(caught).toBeInstanceOf(InternalServerErrorException);
      const response = (
        caught as InternalServerErrorException
      ).getResponse() as {
        message: string;
      };
      // Safe error must NOT leak the provider's internal path or stack.
      expect(JSON.stringify(response)).not.toContain("secret-trace");
      expect(JSON.stringify(response)).not.toContain("key.pem");
      expect(response.message).toBe("Failed to retrieve knowledge pack");
    });
  });

  // ── retryGeneration: Bounded retries ────────────────────────────────

  describe("retryGeneration — Bounded retries", () => {
    it("blocks retry when the latest server failure is not retryable", async () => {
      (repository.getStrategyByIdAndOwner as jest.Mock).mockResolvedValue({
        id: STRAT_ID,
        status: "failed",
        businessId: "biz-1",
        brief: { businessProfileVersionId: "prof-1" },
      });
      (repository.getLatestProgressEvent as jest.Mock).mockResolvedValue({
        status: "failed",
        payload: { retryable: false },
      });

      await expect(service.retryGeneration(STRAT_ID, OWNER_ID)).rejects.toThrow(
        BadRequestException,
      );
      expect(repository.countRetries).not.toHaveBeenCalled();
      expect(queue.add).not.toHaveBeenCalled();
    });

    it("blocks retry when max retries is exceeded", async () => {
      (repository.getStrategyByIdAndOwner as jest.Mock).mockResolvedValue({
        id: STRAT_ID,
        status: "failed",
        businessId: "biz-1",
        brief: { businessProfileVersionId: "prof-1" },
      });
      (repository.countRetries as jest.Mock).mockResolvedValue(3);

      await expect(service.retryGeneration(STRAT_ID, OWNER_ID)).rejects.toThrow(
        BadRequestException,
      );
      expect(queue.add).not.toHaveBeenCalled();
    });

    it("blocks retry when the profile is now stale", async () => {
      (repository.getStrategyByIdAndOwner as jest.Mock).mockResolvedValue({
        id: STRAT_ID,
        status: "failed",
        businessId: "biz-1",
        brief: { businessProfileVersionId: "old-prof" },
      });
      (repository.countRetries as jest.Mock).mockResolvedValue(0);
      (
        repository.getActiveConfirmedProfileVersion as jest.Mock
      ).mockResolvedValue({
        id: "new-prof",
      });

      await expect(service.retryGeneration(STRAT_ID, OWNER_ID)).rejects.toThrow(
        BadRequestException,
      );
      expect(queue.add).not.toHaveBeenCalled();
    });

    it("resumes from completed retrieval through every legal transition", async () => {
      (repository.getStrategyByIdAndOwner as jest.Mock).mockResolvedValue({
        id: STRAT_ID,
        status: "failed",
        businessId: "biz-1",
        brief: { businessProfileVersionId: "prof-1" },
      });
      (repository.countRetries as jest.Mock).mockResolvedValue(0);
      (repository.getLatestVersion as jest.Mock).mockResolvedValue({
        id: "v-1",
      });
      (
        repository.getActiveConfirmedProfileVersion as jest.Mock
      ).mockResolvedValue({
        id: "prof-1",
      });
      (repository.getLatestRetrievalRun as jest.Mock).mockResolvedValue({
        id: "run-1",
        status: "completed",
      });
      (repository.claimForGeneration as jest.Mock)
        .mockResolvedValueOnce({ claimed: true })
        .mockResolvedValueOnce({ claimed: true });

      const result = await service.retryGeneration(STRAT_ID, OWNER_ID);

      expect(result.status).toBe("queued");
      expect(repository.claimForGeneration).toHaveBeenNthCalledWith(
        1,
        STRAT_ID,
        ["failed"],
        "ready",
      );
      expect(repository.claimForGeneration).toHaveBeenNthCalledWith(
        2,
        STRAT_ID,
        ["ready"],
        "retrieving",
      );
      expect(repository.updateStrategyStatus).toHaveBeenCalledWith(
        STRAT_ID,
        "queued",
      );
      expect(queue.add).toHaveBeenCalledWith(
        "generate-strategy",
        expect.objectContaining({ retrievalRunId: "run-1" }),
        expect.any(Object),
      );
    });

    it("restarts from scratch when retrieval also failed (failed → ready then startGeneration)", async () => {
      (repository.getStrategyByIdAndOwner as jest.Mock).mockResolvedValue({
        ...STRATEGY_FIXTURE,
        status: "failed",
      });
      (repository.countRetries as jest.Mock).mockResolvedValue(0);
      (repository.getLatestVersion as jest.Mock).mockResolvedValue({
        id: "v-1",
      });
      (
        repository.getActiveConfirmedProfileVersion as jest.Mock
      ).mockResolvedValue(PROFILE_VERSION_FIXTURE);
      (repository.getLatestRetrievalRun as jest.Mock).mockResolvedValue({
        id: "run-1",
        status: "failed",
      });
      // First claimForGeneration: failed → ready (in retryGeneration)
      // Second claimForGeneration: ready → retrieving (in startGeneration)
      (repository.claimForGeneration as jest.Mock)
        .mockResolvedValueOnce({ claimed: true })
        .mockResolvedValueOnce({ claimed: true });
      httpService.post.mockReturnValue(
        of({ data: { retrieval_run_id: "run-2" } }),
      );

      const result = await service.retryGeneration(STRAT_ID, OWNER_ID);

      expect(result.status).toBe("queued");
      // Two claims: failed → ready, then ready → retrieving
      expect(repository.claimForGeneration).toHaveBeenCalledTimes(2);
    });
  });

  // ── handleDecision ──────────────────────────────────────────────────

  describe("handleDecision", () => {
    it("rejects an outdated immutable version with a safe conflict", async () => {
      (repository.getStrategyByIdAndOwner as jest.Mock).mockResolvedValue({
        id: STRAT_ID,
        status: "draft",
        currentVersionId: "v-2",
        businessId: "biz-1",
        brief: { businessProfileVersionId: "prof-1" },
      });

      await expect(
        service.handleDecision(STRAT_ID, OWNER_ID, {
          versionId: "v-1",
          action: "approve",
        }),
      ).rejects.toThrow(ConflictException);
      expect(repository.recordOwnerDecision).not.toHaveBeenCalled();
    });

    it("requires owner feedback for a revision request", async () => {
      (repository.getStrategyByIdAndOwner as jest.Mock).mockResolvedValue({
        id: STRAT_ID,
        status: "draft",
        currentVersionId: "v-1",
        businessId: "biz-1",
        brief: { businessProfileVersionId: "prof-1" },
      });

      await expect(
        service.handleDecision(STRAT_ID, OWNER_ID, {
          versionId: "v-1",
          action: "revision_requested",
        }),
      ).rejects.toThrow(BadRequestException);
      expect(queue.add).not.toHaveBeenCalled();
    });

    it("blocks approval when the current plan contains a blocking gap", async () => {
      (repository.getStrategyByIdAndOwner as jest.Mock).mockResolvedValue({
        id: STRAT_ID,
        status: "draft",
        currentVersionId: "v-1",
        businessId: "biz-1",
        brief: { businessProfileVersionId: "prof-1" },
      });
      (repository.getVersionById as jest.Mock).mockResolvedValue({
        id: "v-1",
        strategyId: STRAT_ID,
        retrievalRunId: "run-1",
        planData: {
          blockers: [{ severity: "blocking", message: "Budget missing" }],
          citations: [{ chunk_id: "chunk-1" }],
        },
      });
      (
        repository.getActiveConfirmedProfileVersion as jest.Mock
      ).mockResolvedValue({
        id: "prof-1",
      });

      await expect(
        service.handleDecision(STRAT_ID, OWNER_ID, {
          versionId: "v-1",
          action: "approve",
        }),
      ).rejects.toThrow(BadRequestException);
      expect(repository.recordOwnerDecision).not.toHaveBeenCalled();
    });

    it("blocks approval when the latest retrieval run is not the version run", async () => {
      (repository.getStrategyByIdAndOwner as jest.Mock).mockResolvedValue({
        id: STRAT_ID,
        status: "draft",
        currentVersionId: "v-1",
        businessId: "biz-1",
        brief: { businessProfileVersionId: "prof-1" },
      });
      (
        repository.getActiveConfirmedProfileVersion as jest.Mock
      ).mockResolvedValue({
        id: "prof-1",
      });
      (repository.getLatestRetrievalRun as jest.Mock).mockResolvedValue({
        id: "run-2",
        status: "completed",
        items: [
          {
            chunkId: "chunk-1",
            entryId: "entry-1",
            entryVersion: 1,
            reviewStatus: "approved",
            effectiveAt: new Date("2026-01-01T00:00:00.000Z"),
            expiresAt: null,
          },
        ],
      });

      await expect(
        service.handleDecision(STRAT_ID, OWNER_ID, {
          versionId: "v-1",
          action: "approve",
        }),
      ).rejects.toThrow(BadRequestException);
      expect(repository.recordOwnerDecision).not.toHaveBeenCalled();
    });

    it("rejects a decision if strategy is not in draft state", async () => {
      (repository.getStrategyByIdAndOwner as jest.Mock).mockResolvedValue({
        id: STRAT_ID,
        status: "approved",
        businessId: "biz-1",
        brief: {},
      });

      await expect(
        service.handleDecision(STRAT_ID, OWNER_ID, {
          versionId: "v-1",
          action: "approve",
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("atomically rejects a concurrent duplicate revision request", async () => {
      (repository.getStrategyByIdAndOwner as jest.Mock).mockResolvedValue({
        id: STRAT_ID,
        status: "draft",
        currentVersionId: "v-1",
        businessId: "biz-1",
        brief: {},
      });
      (repository.claimForGeneration as jest.Mock).mockResolvedValue({
        claimed: false,
      });

      await expect(
        service.handleDecision(STRAT_ID, OWNER_ID, {
          versionId: "v-1",
          action: "revision_requested",
          feedback: "tighten budget",
        }),
      ).rejects.toThrow(BadRequestException);
      expect(queue.add).not.toHaveBeenCalled();
    });

    it("atomically rejects a concurrent duplicate approve via the conditional UPDATE", async () => {
      // recordOwnerDecision throws when the conditional UPDATE matches zero
      // rows (a concurrent approve already moved the status out of "draft").
      (repository.getStrategyByIdAndOwner as jest.Mock).mockResolvedValue({
        id: STRAT_ID,
        status: "draft",
        currentVersionId: "v-1",
        businessId: "biz-1",
        brief: { businessProfileVersionId: "prof-1" },
      });
      (
        repository.getActiveConfirmedProfileVersion as jest.Mock
      ).mockResolvedValue({
        id: "prof-1",
      });
      (repository.getLatestRetrievalRun as jest.Mock).mockResolvedValue({
        id: "run-1",
        status: "completed",
        items: [
          {
            chunkId: "chunk-1",
            entryId: "entry-1",
            entryVersion: 1,
            reviewStatus: "approved",
            effectiveAt: new Date("2026-01-01T00:00:00.000Z"),
            expiresAt: null,
          },
        ],
      });
      (repository.recordOwnerDecision as jest.Mock).mockRejectedValue(
        new BadRequestException("Strategy is no longer in draft state"),
      );

      await expect(
        service.handleDecision(STRAT_ID, OWNER_ID, {
          versionId: "v-1",
          action: "approve",
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("approves and records a progress event on success", async () => {
      (repository.getStrategyByIdAndOwner as jest.Mock).mockResolvedValue({
        id: STRAT_ID,
        status: "draft",
        currentVersionId: "v-1",
        businessId: "biz-1",
        brief: { businessProfileVersionId: "prof-1" },
      });
      (
        repository.getActiveConfirmedProfileVersion as jest.Mock
      ).mockResolvedValue({
        id: "prof-1",
      });
      (repository.getLatestRetrievalRun as jest.Mock).mockResolvedValue({
        id: "run-1",
        status: "completed",
        items: [
          {
            chunkId: "chunk-1",
            entryId: "entry-1",
            entryVersion: 1,
            reviewStatus: "approved",
            effectiveAt: new Date("2026-01-01T00:00:00.000Z"),
            expiresAt: null,
          },
        ],
      });
      (repository.recordOwnerDecision as jest.Mock).mockResolvedValue({
        decision: { id: "dec-1", action: "approve" },
        nextStatus: "approved",
      });

      const result = await service.handleDecision(STRAT_ID, OWNER_ID, {
        versionId: "v-1",
        action: "approve",
      });

      expect(result.nextStatus).toBe("approved");
      expect(repository.appendProgressEvent).toHaveBeenCalledWith(
        STRAT_ID,
        expect.objectContaining({ messageKey: "strategy.approved" }),
      );
    });
  });

  // ── Ownership / cross-business access ───────────────────────────────

  describe("Ownership enforcement", () => {
    it("returns NotFound when the strategy belongs to another owner", async () => {
      // getStrategyByIdAndOwner returns null for non-owners — the service must
      // surface NotFound so the existence of another owner's strategy is not
      // leaked via 403.
      (repository.getStrategyByIdAndOwner as jest.Mock).mockResolvedValue(null);

      await expect(
        service.getStrategy(STRAT_ID, OTHER_OWNER_ID),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.startGeneration(STRAT_ID, OTHER_OWNER_ID),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.retryGeneration(STRAT_ID, OTHER_OWNER_ID),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.handleDecision(STRAT_ID, OTHER_OWNER_ID, {
          versionId: "v-1",
          action: "approve",
        }),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.getStrategyVersion(STRAT_ID, 1, OTHER_OWNER_ID),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.getRetrievalPack(STRAT_ID, OTHER_OWNER_ID),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("Strategy plan reads", () => {
    it("returns the persisted current plan with the Strategy resource", async () => {
      (repository.getStrategyByIdAndOwner as jest.Mock).mockResolvedValue({
        id: STRAT_ID,
        status: "draft",
        currentVersionId: "v-1",
        brief: {},
      });
      (repository.getVersionById as jest.Mock).mockResolvedValue({
        id: "v-1",
        strategyId: STRAT_ID,
        planData: { id: "plan-1", version: 1 },
      });

      await expect(service.getStrategy(STRAT_ID, OWNER_ID)).resolves.toEqual(
        expect.objectContaining({
          id: STRAT_ID,
          latestPlan: { id: "plan-1", version: 1 },
        }),
      );
    });

    it("returns plan data rather than the internal database row for a version", async () => {
      (repository.getStrategyByIdAndOwner as jest.Mock).mockResolvedValue({
        id: STRAT_ID,
      });
      (repository.getVersionByNumber as jest.Mock).mockResolvedValue({
        id: "v-1",
        planData: { id: "plan-1", version: 1 },
      });

      await expect(
        service.getStrategyVersion(STRAT_ID, 1, OWNER_ID),
      ).resolves.toEqual({ id: "plan-1", version: 1 });
    });
  });

  // ── Lifecycle progress events ───────────────────────────────────────

  describe("Lifecycle progress events", () => {
    it("records a progress event on every lifecycle transition", async () => {
      (repository.getStrategyByIdAndOwner as jest.Mock).mockResolvedValue(
        STRATEGY_FIXTURE,
      );
      (repository.claimForGeneration as jest.Mock).mockResolvedValue({
        claimed: true,
      });
      (
        repository.getActiveConfirmedProfileVersion as jest.Mock
      ).mockResolvedValue(PROFILE_VERSION_FIXTURE);
      httpService.post.mockReturnValue(
        of({ data: { retrieval_run_id: "run-1" } }),
      );

      await service.startGeneration(STRAT_ID, OWNER_ID);

      // At least retrieval.started, retrieval.complete, queued events.
      expect(repository.appendProgressEvent).toHaveBeenCalledWith(
        STRAT_ID,
        expect.objectContaining({ messageKey: "strategy.retrieval.started" }),
      );
      expect(repository.appendProgressEvent).toHaveBeenCalledWith(
        STRAT_ID,
        expect.objectContaining({ messageKey: "strategy.retrieval.complete" }),
      );
      expect(repository.appendProgressEvent).toHaveBeenCalledWith(
        STRAT_ID,
        expect.objectContaining({ messageKey: "strategy.queued" }),
      );
    });

    it("does not throw when progress persistence fails", async () => {
      (repository.getStrategyByIdAndOwner as jest.Mock).mockResolvedValue(
        STRATEGY_FIXTURE,
      );
      (repository.claimForGeneration as jest.Mock).mockResolvedValue({
        claimed: true,
      });
      (
        repository.getActiveConfirmedProfileVersion as jest.Mock
      ).mockResolvedValue(PROFILE_VERSION_FIXTURE);
      (repository.appendProgressEvent as jest.Mock).mockRejectedValue(
        new Error("db down"),
      );
      httpService.post.mockReturnValue(
        of({ data: { retrieval_run_id: "run-1" } }),
      );

      // The lifecycle must proceed even if audit persistence fails.
      await expect(
        service.startGeneration(STRAT_ID, OWNER_ID),
      ).resolves.toEqual(expect.objectContaining({ status: "queued" }));
    });

    it("returns persisted progress events in contract shape", async () => {
      (repository.getStrategyByIdAndOwner as jest.Mock).mockResolvedValue({
        id: STRAT_ID,
        status: "queued",
      });
      (repository.listProgressEvents as jest.Mock).mockResolvedValue([
        {
          strategyId: STRAT_ID,
          seq: 1,
          stage: "retrieval",
          status: "complete",
          messageKey: "strategy.retrieval.complete",
          messageText: "Knowledge retrieval complete.",
          payload: { retrieval_run_id: "run-1", retryable: true },
          createdAt: new Date("2026-07-28T10:00:00.000Z"),
        },
      ]);

      await expect(
        service.getProgressEvents(STRAT_ID, OWNER_ID),
      ).resolves.toEqual([
        {
          type: "strategy_progress",
          strategy_id: STRAT_ID,
          seq: 1,
          stage: "retrieval",
          status: "complete",
          message_key: "strategy.retrieval.complete",
          message_text: "Knowledge retrieval complete.",
          retryable: true,
          payload: { retrieval_run_id: "run-1", retryable: true },
          created_at: "2026-07-28T10:00:00.000Z",
        },
      ]);
    });
  });

  describe("getStrategyVersions", () => {
    it("maps retrieval runs to non-empty brief ids", async () => {
      (repository.getStrategyByIdAndOwner as jest.Mock).mockResolvedValue({
        id: STRAT_ID,
        status: "approved",
      });
      (repository.listVersions as jest.Mock).mockResolvedValue([
        {
          id: "v-1",
          strategyId: STRAT_ID,
          version: 1,
          retrievalRunId: "run-1",
          promptConfig: {
            model: "fake",
            apiKey: "must-not-leak",
            authorization: "must-not-leak",
          },
          planData: {
            profile_version: {
              business_profile_version_id: "profile-1",
              confirmed_at: "2026-07-28T09:00:00.000Z",
              version: 1,
            },
          },
          createdAt: new Date("2026-07-28T10:00:00.000Z"),
          decisions: [
            {
              id: "decision-1",
              action: "approve",
              feedback: null,
              ownerUserId: OWNER_ID,
              createdAt: new Date("2026-07-28T10:30:00.000Z"),
            },
          ],
        },
      ]);
      (repository.listRetrievalRunBriefIds as jest.Mock).mockResolvedValue([
        { id: "run-1", briefId: "brief-1" },
      ]);

      await expect(
        service.getStrategyVersions(STRAT_ID, OWNER_ID),
      ).resolves.toEqual([
        expect.objectContaining({
          strategy_id: STRAT_ID,
          version: 1,
          status: "approved",
          brief_id: "brief-1",
          retrieval_run_id: "run-1",
          prompt_config: { model: "fake" },
          decision: expect.objectContaining({
            decision: "approved",
          }),
        }),
      ]);
    });
  });
});
