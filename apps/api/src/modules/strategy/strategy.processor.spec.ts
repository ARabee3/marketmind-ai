import { Test, TestingModule } from "@nestjs/testing";
import { BadRequestException } from "@nestjs/common";
import { HttpService } from "@nestjs/axios";
import { ConfigService } from "@nestjs/config";
import { of, throwError } from "rxjs";
import { StrategyProcessor } from "./strategy.processor";
import { StrategyRepository } from "./strategy.repository";

type MockedRepo = jest.Mocked<Partial<StrategyRepository>>;

const PROFILE_VERSION_FIXTURE = {
  id: "prof-1",
  businessId: "biz-1",
  draftId: "draft-1",
  version: 1,
  confirmedByUserId: "user-1",
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
  id: "strat-1",
  status: "ready",
  businessId: "biz-1",
  brief: {
    id: "brief-1",
    strategyId: "strat-1",
    businessProfileVersionId: "prof-1",
    primaryObjective: "conversion",
    startDate: new Date("2026-08-01T00:00:00.000Z"),
    planLanguage: "ar-EG",
    paidMediaAllowed: false,
    externalBudgetMode: "organic_only",
    externalBudgetEgp: null,
    teamCapacity: "owner plus one helper",
    constraints: "Keep posts in Arabic.\nPost twice weekly.",
    clarificationAnswers: [],
    createdAt: new Date("2026-07-28T09:00:00.000Z"),
    updatedAt: new Date("2026-07-28T09:00:00.000Z"),
  },
  business: { id: "biz-1", businessType: "dessert shop", primaryLocale: "ar-EG" },
};

const RETRIEVAL_RUN_FIXTURE = {
  id: "run-1",
  strategyId: "strat-1",
  briefId: "brief-1",
  profileVersionId: "prof-1",
  querySummary: "Retrieved knowledge for dessert shop.",
  queryContext: { objective: "conversion", funnel_stage: "conversion" },
  configuration: {
    embedding_provider: "fake",
    collection_name: "marketing_knowledge_v1",
  },
  latencyMs: 42,
  createdAt: new Date("2026-07-28T10:00:00.000Z"),
  finishedAt: new Date("2026-07-28T10:00:01.000Z"),
  items: [
    {
      chunkId: "chunk-1",
      entryId: "entry-1",
      entryVersion: 1,
      title: "Seasonal menu tactics",
      excerpt: "Bundle desserts around seasonal fruits.",
      kind: "tactic",
      tags: { region: ["egypt"] },
      relevanceScore: 0.91,
      evidenceTier: "A",
      sourceReferences: ["https://example.com/source"],
      effectiveAt: new Date("2026-01-01T00:00:00.000Z"),
      expiresAt: null,
      reviewStatus: "reviewed",
      marketTier: "egypt",
      isFallback: false,
      fallbackLabel: null,
    },
  ],
  gaps: [
    {
      category: "budget",
      description: "No verified ad spend figures.",
      severity: "non_critical",
    },
  ],
};

function makeRepository(overrides: Partial<MockedRepo> = {}): MockedRepo {
  return {
    updateStrategyStatus: jest.fn().mockResolvedValue({}),
    appendStrategyVersion: jest.fn(),
    getStrategyByIdAndOwner: jest.fn(),
    readStrategy: jest.fn().mockResolvedValue(STRATEGY_FIXTURE),
    getProfileVersionById: jest.fn().mockResolvedValue(PROFILE_VERSION_FIXTURE),
    getRetrievalRunById: jest.fn().mockResolvedValue(RETRIEVAL_RUN_FIXTURE),
    getVersionById: jest.fn().mockResolvedValue({ id: "ver-1", planData: {} }),
    getLatestRetrievalRun: jest.fn(),
    appendProgressEvent: jest.fn().mockResolvedValue({}),
    ...overrides,
  };
}

describe("StrategyProcessor", () => {
  let processor: StrategyProcessor;
  let repository: MockedRepo;
  let httpService: { post: jest.Mock };

  const baseJob = {
    strategyId: "strat-1",
    retrievalRunId: "run-1",
    correlationId: "corr-1",
  };

  beforeEach(async () => {
    repository = makeRepository();
    httpService = { post: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StrategyProcessor,
        { provide: StrategyRepository, useValue: repository },
        { provide: HttpService, useValue: httpService },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue("http://localhost:8000") },
        },
      ],
    }).compile();

    processor = module.get<StrategyProcessor>(StrategyProcessor);
  });

  // ── generate-strategy: success ──────────────────────────────────────

  describe("handleGenerate — success", () => {
    it("transitions queued → generating → validating → draft and persists an immutable version", async () => {
      const validPlan = {
        id: "plan-1",
        strategy_id: "strat-1",
        version: 1,
        contract_version: "2026-07-01",
        brief_id: "brief-1",
        retrieval_run_id: "run-1",
        executive_summary: { text: "summary", source: "model_synthesis", citation_ids: [] },
        situation_diagnosis: { text: "diag", source: "model_synthesis", citation_ids: [] },
        primary_objective: "awareness",
        selected_channels: [],
        all_channel_scores: [],
        content_strategy: { format_mix: [], weekly_cadence: "1", weeks: [], experiments: [] },
        budget_mode: "organic_only",
        kpi_targets: [],
        citations: [],
        created_at: "2026-07-28T10:00:00.000Z",
      };
      httpService.post
        .mockReturnValueOnce(
          of({ data: { deterministic_channel_scores: [] } }),
        )
        .mockReturnValueOnce(
          of({
            data: {
              plan: validPlan,
              validation: { valid: true, issues: [] },
              prompt_config: { model: "gpt-4o" },
            },
          }),
        );
      (repository.appendStrategyVersion as jest.Mock).mockResolvedValue({
        id: "ver-1",
        version: 1,
      });

      const result = await processor.process({
        id: "job-1",
        name: "generate-strategy",
        data: baseJob,
      } as never);

      expect(result).toEqual({ success: true, versionId: "ver-1" });
      expect(repository.updateStrategyStatus).toHaveBeenCalledWith("strat-1", "generating");
      expect(repository.updateStrategyStatus).toHaveBeenCalledWith("strat-1", "validating");
      expect(repository.appendStrategyVersion).toHaveBeenCalledWith(
        "strat-1",
        "run-1",
        expect.objectContaining({ id: "plan-1", strategy_id: "strat-1" }),
        { model: "gpt-4o" },
      );
    });
  });

  // ── generate-strategy: FastAPI timeout/error ────────────────────────

  describe("handleGenerate — FastAPI errors", () => {
    it("transitions to failed and re-throws on FastAPI timeout", async () => {
      httpService.post.mockReturnValue(
        throwError(() => new Error("timeout")),
      );

      await expect(
        processor.process({
          id: "job-1",
          name: "generate-strategy",
          data: baseJob,
        } as never),
      ).rejects.toThrow();

      expect(repository.updateStrategyStatus).toHaveBeenCalledWith("strat-1", "failed");
      // No version was persisted.
      expect(repository.appendStrategyVersion).not.toHaveBeenCalled();
    });

    it("transitions to failed on invalid response (missing plan)", async () => {
      httpService.post.mockReturnValue(of({ data: {} }));

      await expect(
        processor.process({
          id: "job-1",
          name: "generate-strategy",
          data: baseJob,
        } as never),
      ).rejects.toThrow();

      expect(repository.updateStrategyStatus).toHaveBeenCalledWith("strat-1", "failed");
      expect(repository.appendStrategyVersion).not.toHaveBeenCalled();
    });

    it("transitions to failed when plan fails structural validation", async () => {
      httpService.post.mockReturnValue(
        of({ data: { plan: { id: "plan-1" }, prompt_config: {} } }),
      );

      await expect(
        processor.process({
          id: "job-1",
          name: "generate-strategy",
          data: baseJob,
        } as never),
      ).rejects.toThrow();

      expect(repository.updateStrategyStatus).toHaveBeenCalledWith("strat-1", "failed");
      expect(repository.appendStrategyVersion).not.toHaveBeenCalled();
    });

    it("does not persist a generated plan that fails the language gate", async () => {
      const validPlan = {
        id: "plan-1",
        strategy_id: "strat-1",
        version: 1,
        contract_version: "2026-07-01",
        brief_id: "brief-1",
        retrieval_run_id: "run-1",
        executive_summary: { text: "summary", source: "model_synthesis", citation_ids: [] },
        situation_diagnosis: { text: "diag", source: "model_synthesis", citation_ids: [] },
        primary_objective: "awareness",
        selected_channels: [],
        all_channel_scores: [],
        content_strategy: { format_mix: [], weekly_cadence: "1", weeks: [], experiments: [] },
        budget_mode: "organic_only",
        kpi_targets: [],
        citations: [],
        created_at: "2026-07-28T10:00:00.000Z",
      };
      httpService.post
        .mockReturnValueOnce(
          of({ data: { deterministic_channel_scores: [] } }),
        )
        .mockReturnValueOnce(
          of({
            data: {
              plan: validPlan,
              validation: {
                valid: false,
                issues: [{
                  code: "STRATEGY_LANGUAGE_MISMATCH",
                  field: "plan.executive_summary.text",
                  message: "Expected Arabic owner-facing prose.",
                }],
              },
            },
          }),
        );

      await expect(
        processor.process({
          id: "job-1",
          name: "generate-strategy",
          data: baseJob,
        } as never),
      ).rejects.toThrow("failed the language gate");

      expect(repository.updateStrategyStatus).toHaveBeenCalledWith("strat-1", "failed");
      expect(repository.appendStrategyVersion).not.toHaveBeenCalled();
    });

    it("does not persist a generated plan without a validation result", async () => {
      const successResponse = {
        id: "plan-1",
        strategy_id: "strat-1",
        version: 1,
        contract_version: "2026-07-01",
        brief_id: "brief-1",
        retrieval_run_id: "run-1",
        executive_summary: { text: "summary", source: "model_synthesis", citation_ids: [] },
        situation_diagnosis: { text: "diag", source: "model_synthesis", citation_ids: [] },
        primary_objective: "awareness",
        selected_channels: [],
        all_channel_scores: [],
        content_strategy: { format_mix: [], weekly_cadence: "1", weeks: [], experiments: [] },
        budget_mode: "organic_only",
        kpi_targets: [],
        citations: [],
        created_at: "2026-07-28T10:00:00.000Z",
      };
      httpService.post
        .mockReturnValueOnce(
          of({ data: { deterministic_channel_scores: [] } }),
        )
        .mockReturnValueOnce(of({ data: { plan: successResponse } }));

      await expect(
        processor.process({
          id: "job-1",
          name: "generate-strategy",
          data: baseJob,
        } as never),
      ).rejects.toThrow("no valid validation result");

      expect(repository.appendStrategyVersion).not.toHaveBeenCalled();
    });
  });

  // ── generate-strategy: FSM violation ────────────────────────────────

  describe("handleGenerate — FSM validation", () => {
    it("fails the job when queued → generating is an illegal transition", async () => {
      // Simulate the strategy having been moved to "draft" concurrently, so
      // the FSM rejects queued → generating.
      (repository.updateStrategyStatus as jest.Mock).mockRejectedValueOnce(
        new BadRequestException("Invalid strategy lifecycle transition: draft → generating"),
      );

      await expect(
        processor.process({
          id: "job-1",
          name: "generate-strategy",
          data: baseJob,
        } as never),
      ).rejects.toThrow(BadRequestException);

      // No provider call, no version persisted.
      expect(httpService.post).not.toHaveBeenCalled();
      expect(repository.appendStrategyVersion).not.toHaveBeenCalled();
    });
  });

  // ── revise-strategy: success preserves the prior draft ─────────────

  describe("handleRevise — success", () => {
    it("runs retrieval then revise and persists a new immutable version", async () => {
      (repository.readStrategy as jest.Mock).mockResolvedValue(STRATEGY_FIXTURE);
      (repository.getRetrievalRunById as jest.Mock).mockResolvedValue({
        ...RETRIEVAL_RUN_FIXTURE,
        id: "run-2",
      });
      httpService.post
        .mockReturnValueOnce(of({ data: { retrieval_run_id: "run-2" } }))
        .mockReturnValueOnce(
          of({ data: { deterministic_channel_scores: [] } }),
        )
        .mockReturnValueOnce(
          of({
            data: {
              plan: {
                id: "plan-2",
                strategy_id: "strat-1",
                version: 2,
                contract_version: "2026-07-01",
                brief_id: "brief-1",
                retrieval_run_id: "run-2",
                executive_summary: { text: "v2", source: "model_synthesis", citation_ids: [] },
                situation_diagnosis: { text: "v2", source: "model_synthesis", citation_ids: [] },
                primary_objective: "acquisition",
                selected_channels: [],
                all_channel_scores: [],
                content_strategy: { format_mix: [], weekly_cadence: "2", weeks: [], experiments: [] },
                budget_mode: "organic_only",
                kpi_targets: [],
                citations: [],
                created_at: "2026-07-28T11:00:00.000Z",
              },
              validation: { valid: true, issues: [] },
              prompt_config: {},
            },
          }),
        );
      (repository.appendStrategyVersion as jest.Mock).mockResolvedValue({
        id: "ver-2",
        version: 2,
      });

      const result = await processor.process({
        id: "job-2",
        name: "revise-strategy",
        data: {
          strategyId: "strat-1",
          priorVersionId: "ver-1",
          feedback: "tighten budget",
          correlationId: "corr-2",
        },
      } as never);

      expect(result).toEqual({ success: true, versionId: "ver-2" });
      // Three HTTP calls: retrieve then score then revise.
      expect(httpService.post).toHaveBeenCalledTimes(3);
      // The new version is persisted with the new retrieval run, not the prior.
      expect(repository.appendStrategyVersion).toHaveBeenCalledWith(
        "strat-1",
        "run-2",
        expect.objectContaining({ id: "plan-2", version: 2 }),
        {},
      );
    });
  });

  // ── revise-strategy: failed revision never destroys the prior draft ─

  describe("handleRevise — failure preserves the prior draft", () => {
    it("does not call appendStrategyVersion when revision generation fails", async () => {
      (repository.readStrategy as jest.Mock).mockResolvedValue(STRATEGY_FIXTURE);
      (repository.getRetrievalRunById as jest.Mock).mockResolvedValue({
        ...RETRIEVAL_RUN_FIXTURE,
        id: "run-2",
      });
      httpService.post
        .mockReturnValueOnce(of({ data: { retrieval_run_id: "run-2" } }))
        .mockReturnValueOnce(
          of({ data: { deterministic_channel_scores: [] } }),
        )
        .mockReturnValueOnce(throwError(() => new Error("provider down")));

      await expect(
        processor.process({
          id: "job-2",
          name: "revise-strategy",
          data: {
            strategyId: "strat-1",
            priorVersionId: "ver-1",
            feedback: "tighten budget",
            correlationId: "corr-2",
          },
        } as never),
      ).rejects.toThrow();

      // Strategy marked failed, but no new version row was written — the
      // prior draft (ver-1) is untouched.
      expect(repository.updateStrategyStatus).toHaveBeenCalledWith("strat-1", "failed");
      expect(repository.appendStrategyVersion).not.toHaveBeenCalled();
    });

    it("does not persist a revised plan that fails the language gate", async () => {
      (repository.readStrategy as jest.Mock).mockResolvedValue(STRATEGY_FIXTURE);
      (repository.getRetrievalRunById as jest.Mock).mockResolvedValue({
        ...RETRIEVAL_RUN_FIXTURE,
        id: "run-2",
      });
      httpService.post
        .mockReturnValueOnce(of({ data: { retrieval_run_id: "run-2" } }))
        .mockReturnValueOnce(
          of({ data: { deterministic_channel_scores: [] } }),
        )
        .mockReturnValueOnce(
          of({
            data: {
              plan: {
                id: "plan-2",
                strategy_id: "strat-1",
                version: 2,
                contract_version: "2026-07-01",
                brief_id: "brief-1",
                retrieval_run_id: "run-2",
                executive_summary: { text: "v2", source: "model_synthesis", citation_ids: [] },
                situation_diagnosis: { text: "v2", source: "model_synthesis", citation_ids: [] },
                primary_objective: "acquisition",
                selected_channels: [],
                all_channel_scores: [],
                content_strategy: { format_mix: [], weekly_cadence: "2", weeks: [], experiments: [] },
                budget_mode: "organic_only",
                kpi_targets: [],
                citations: [],
                created_at: "2026-07-28T11:00:00.000Z",
              },
              validation: {
                valid: false,
                issues: [{
                  code: "STRATEGY_LANGUAGE_MISMATCH",
                  field: "plan.positioning.text",
                  message: "Expected Arabic owner-facing prose.",
                }],
              },
            },
          }),
        );

      await expect(
        processor.process({
          id: "job-2",
          name: "revise-strategy",
          data: {
            strategyId: "strat-1",
            priorVersionId: "ver-1",
            feedback: "tighten budget",
            correlationId: "corr-2",
          },
        } as never),
      ).rejects.toThrow("failed the language gate");

      expect(repository.updateStrategyStatus).toHaveBeenCalledWith("strat-1", "failed");
      expect(repository.appendStrategyVersion).not.toHaveBeenCalled();
    });

    it("transitions to failed when revision retrieval fails", async () => {
      (repository.readStrategy as jest.Mock).mockResolvedValue({
        id: "strat-1",
        brief: { businessProfileVersionId: "prof-1" },
      });
      httpService.post.mockReturnValueOnce(
        throwError(() => new Error("timeout")),
      );

      await expect(
        processor.process({
          id: "job-2",
          name: "revise-strategy",
          data: {
            strategyId: "strat-1",
            priorVersionId: "ver-1",
            feedback: "tighten budget",
            correlationId: "corr-2",
          },
        } as never),
      ).rejects.toThrow();

      expect(repository.updateStrategyStatus).toHaveBeenCalledWith("strat-1", "failed");
      expect(repository.appendStrategyVersion).not.toHaveBeenCalled();
    });
  });

  // ── unknown job type ────────────────────────────────────────────────

  describe("unknown job type", () => {
    it("logs a warning and returns without throwing", async () => {
      await expect(
        processor.process({
          id: "job-x",
          name: "unknown",
          data: {},
        } as never),
      ).resolves.toBeUndefined();
    });
  });
});
