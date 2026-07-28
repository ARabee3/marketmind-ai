import { Test, TestingModule } from "@nestjs/testing";
import { BadRequestException } from "@nestjs/common";
import { HttpService } from "@nestjs/axios";
import { ConfigService } from "@nestjs/config";
import { of, throwError } from "rxjs";
import { StrategyProcessor } from "./strategy.processor";
import { StrategyRepository } from "./strategy.repository";

type MockedRepo = jest.Mocked<Partial<StrategyRepository>>;

function makeRepository(overrides: Partial<MockedRepo> = {}): MockedRepo {
  return {
    updateStrategyStatus: jest.fn().mockResolvedValue({}),
    appendStrategyVersion: jest.fn(),
    getStrategyByIdAndOwner: jest.fn(),
    readStrategy: jest.fn(),
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
      httpService.post.mockReturnValue(
        of({ data: { plan: { sections: [] }, prompt_config: { model: "gpt-4o" } } }),
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
        { sections: [] },
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
      (repository.readStrategy as jest.Mock).mockResolvedValue({
        id: "strat-1",
        brief: { businessProfileVersionId: "prof-1" },
      });
      httpService.post
        .mockReturnValueOnce(of({ data: { retrieval_run_id: "run-2" } }))
        .mockReturnValueOnce(
          of({ data: { plan: { sections: ["v2"] }, prompt_config: {} } }),
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
      // Two HTTP calls: retrieve then revise.
      expect(httpService.post).toHaveBeenCalledTimes(2);
      // The new version is persisted with the new retrieval run, not the prior.
      expect(repository.appendStrategyVersion).toHaveBeenCalledWith(
        "strat-1",
        "run-2",
        { sections: ["v2"] },
        {},
      );
    });
  });

  // ── revise-strategy: failed revision never destroys the prior draft ─

  describe("handleRevise — failure preserves the prior draft", () => {
    it("does not call appendStrategyVersion when revision generation fails", async () => {
      (repository.readStrategy as jest.Mock).mockResolvedValue({
        id: "strat-1",
        brief: { businessProfileVersionId: "prof-1" },
      });
      httpService.post
        .mockReturnValueOnce(of({ data: { retrieval_run_id: "run-2" } }))
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