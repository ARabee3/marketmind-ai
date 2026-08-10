import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { HttpService } from "@nestjs/axios";
import { of, throwError } from "rxjs";
import { OutboxDispatcher } from "./outbox-dispatcher";
import { PublicationCandidateRepository } from "./repositories/publication-candidate.repository";
import type { PublicationCandidateSink } from "../publishing/candidates/publication-candidate-sink";

describe("OutboxDispatcher", () => {
  let dispatcher: OutboxDispatcher;
  let candidateRepo: jest.Mocked<PublicationCandidateRepository>;
  let httpService: jest.Mocked<HttpService>;
  let configService: jest.Mocked<ConfigService>;

  beforeEach(async () => {
    const mockCandidateRepo = {
      getOutboxEventById: jest.fn(),
      markOutboxDispatched: jest.fn(),
      markOutboxFailed: jest.fn(),
    };

    const mockHttpService = {
      post: jest.fn(),
    };

    const mockConfigService = {
      get: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OutboxDispatcher,
        {
          provide: PublicationCandidateRepository,
          useValue: mockCandidateRepo,
        },
        {
          provide: HttpService,
          useValue: mockHttpService,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    dispatcher = module.get<OutboxDispatcher>(OutboxDispatcher);
    candidateRepo = module.get(PublicationCandidateRepository);
    httpService = module.get(HttpService);
    configService = module.get(ConfigService);
  });

  describe("process", () => {
    const mockEvent = {
      id: 1n,
      eventId: "test-event-id",
      eventType: "content.publication_candidate.created.v1",
      correlationId: "test-correlation-id",
      candidateId: "test-candidate-id",
      payload: { test: "data" },
      state: "pending",
      attempts: 0,
      lastError: null,
      nextAttemptAt: null,
      leaseOwner: null,
      leaseExpiresAt: null,
      createdAt: new Date(),
      dispatchedAt: null,
      updatedAt: new Date(),
    };

    it("should mark event as dispatched when webhook URL is not configured", async () => {
      configService.get.mockReturnValue(undefined);
      candidateRepo.getOutboxEventById.mockResolvedValue(mockEvent);

      await dispatcher.process({
        data: { eventId: "test-event-id" },
      } as any);

      expect(candidateRepo.getOutboxEventById).toHaveBeenCalledWith(
        "test-event-id",
      );
      expect(candidateRepo.markOutboxDispatched).not.toHaveBeenCalled();
      expect(httpService.post).not.toHaveBeenCalled();
    });

    it("should dispatch event to webhook URL when configured", async () => {
      configService.get.mockReturnValue("https://webhook.example.com");
      candidateRepo.getOutboxEventById.mockResolvedValue(mockEvent);
      httpService.post.mockReturnValue(of({ status: 200, data: {} }) as any);
      candidateRepo.markOutboxDispatched.mockResolvedValue(undefined);

      await dispatcher.process({
        data: { eventId: "test-event-id" },
      } as any);

      expect(candidateRepo.getOutboxEventById).toHaveBeenCalledWith(
        "test-event-id",
      );
      expect(httpService.post).toHaveBeenCalledWith(
        "https://webhook.example.com",
        mockEvent.payload,
        {
          timeout: 10000,
          headers: {
            "Content-Type": "application/json",
            "X-Event-Id": "test-event-id",
            "X-Event-Type": "content.publication_candidate.created.v1",
          },
        },
      );
      expect(candidateRepo.markOutboxDispatched).toHaveBeenCalledWith(
        "test-event-id",
      );
      expect(candidateRepo.markOutboxFailed).not.toHaveBeenCalled();
    });

    it("should use the local publication sink when it is available", async () => {
      const sink: jest.Mocked<PublicationCandidateSink> = {
        ingestEvent: jest.fn().mockResolvedValue({
          disposition: "applied",
          candidate: null,
        }),
      };
      configService.get.mockReturnValue("https://webhook.example.com");
      candidateRepo.getOutboxEventById.mockResolvedValue(mockEvent);
      candidateRepo.markOutboxDispatched.mockResolvedValue(undefined);
      const localDispatcher = new OutboxDispatcher(
        candidateRepo,
        httpService,
        configService,
        undefined,
        sink,
      );

      await localDispatcher.process({
        data: { eventId: "test-event-id" },
      } as any);

      expect(sink.ingestEvent).toHaveBeenCalledWith(mockEvent.payload);
      expect(httpService.post).not.toHaveBeenCalled();
      expect(candidateRepo.markOutboxDispatched).toHaveBeenCalledWith(
        "test-event-id",
      );
    });

    it("should retry through the outbox when the local sink rejects an event", async () => {
      const sink: jest.Mocked<PublicationCandidateSink> = {
        ingestEvent: jest
          .fn()
          .mockRejectedValue(new Error("Database unavailable")),
      };
      configService.get.mockReturnValue(undefined);
      candidateRepo.getOutboxEventById.mockResolvedValue(mockEvent);
      candidateRepo.markOutboxFailed.mockResolvedValue(undefined);
      const localDispatcher = new OutboxDispatcher(
        candidateRepo,
        httpService,
        configService,
        undefined,
        sink,
      );

      await expect(
        localDispatcher.process({
          data: { eventId: "test-event-id" },
        } as any),
      ).rejects.toThrow("Database unavailable");

      expect(candidateRepo.markOutboxFailed).toHaveBeenCalledWith(
        "test-event-id",
        "Database unavailable",
      );
      expect(httpService.post).not.toHaveBeenCalled();
    });

    it("dispatches a claimed processing event and completes its lease", async () => {
      const claimedEvent = { ...mockEvent, state: "processing" };
      const repository = {
        claimOutboxByEventId: jest.fn().mockResolvedValue(claimedEvent),
        markOutboxDispatched: jest.fn().mockResolvedValue(undefined),
        markOutboxFailed: jest.fn().mockResolvedValue(undefined),
      };
      const claimedDispatcher = new OutboxDispatcher(
        repository as any,
        httpService,
        configService,
      );
      configService.get.mockReturnValue("https://webhook.example.com");
      httpService.post.mockReturnValue(of({ status: 200, data: {} }) as any);

      await claimedDispatcher.process({
        id: "bull-publication-1",
        data: { eventId: "test-event-id" },
      } as any);

      expect(repository.claimOutboxByEventId).toHaveBeenCalledWith(
        "test-event-id",
        "publication-worker:bull-publication-1",
      );
      expect(httpService.post).toHaveBeenCalled();
      expect(repository.markOutboxDispatched).toHaveBeenCalledWith(
        "test-event-id",
        "publication-worker:bull-publication-1",
      );
      expect(repository.markOutboxFailed).not.toHaveBeenCalled();
    });

    it("should mark event as failed when webhook call fails", async () => {
      configService.get.mockReturnValue("https://webhook.example.com");
      candidateRepo.getOutboxEventById.mockResolvedValue(mockEvent);
      httpService.post.mockReturnValue(
        throwError(() => new Error("Network error")),
      );
      candidateRepo.markOutboxFailed.mockResolvedValue(undefined);

      await expect(
        dispatcher.process({
          data: { eventId: "test-event-id" },
        } as any),
      ).rejects.toThrow("Network error");

      expect(candidateRepo.getOutboxEventById).toHaveBeenCalledWith(
        "test-event-id",
      );
      expect(httpService.post).toHaveBeenCalled();
      expect(candidateRepo.markOutboxFailed).toHaveBeenCalledWith(
        "test-event-id",
        "Network error",
      );
      expect(candidateRepo.markOutboxDispatched).not.toHaveBeenCalled();
    });

    it("should handle event not found gracefully", async () => {
      configService.get.mockReturnValue("https://webhook.example.com");
      candidateRepo.getOutboxEventById.mockResolvedValue(null);

      await dispatcher.process({
        data: { eventId: "non-existent-event" },
      } as any);

      expect(candidateRepo.getOutboxEventById).toHaveBeenCalledWith(
        "non-existent-event",
      );
      expect(httpService.post).not.toHaveBeenCalled();
      expect(candidateRepo.markOutboxDispatched).not.toHaveBeenCalled();
      expect(candidateRepo.markOutboxFailed).not.toHaveBeenCalled();
    });

    it("should handle event with different eventId", async () => {
      configService.get.mockReturnValue("https://webhook.example.com");
      candidateRepo.getOutboxEventById.mockResolvedValue(null);

      await dispatcher.process({
        data: { eventId: "different-event-id" },
      } as any);

      expect(candidateRepo.getOutboxEventById).toHaveBeenCalledWith(
        "different-event-id",
      );
      expect(httpService.post).not.toHaveBeenCalled();
      expect(candidateRepo.markOutboxDispatched).not.toHaveBeenCalled();
      expect(candidateRepo.markOutboxFailed).not.toHaveBeenCalled();
    });

    it("should handle non-Error exceptions", async () => {
      configService.get.mockReturnValue("https://webhook.example.com");
      candidateRepo.getOutboxEventById.mockResolvedValue(mockEvent);
      httpService.post.mockReturnValue(throwError(() => "String error"));
      candidateRepo.markOutboxFailed.mockResolvedValue(undefined);

      let thrownError: any;
      try {
        await dispatcher.process({
          data: { eventId: "test-event-id" },
        } as any);
      } catch (error) {
        thrownError = error;
      }

      expect(thrownError).toBe("String error");
      expect(candidateRepo.markOutboxFailed).toHaveBeenCalledWith(
        "test-event-id",
        "Unknown error",
      );
    });
  });

  describe("reconcile", () => {
    it("queues due events with a deterministic Bull job and releases the lease", async () => {
      const repository = {
        claimDueOutboxEvents: jest
          .fn()
          .mockResolvedValue([{ eventId: "event-reconcile-1" }]),
        releaseOutboxClaim: jest.fn().mockResolvedValue(true),
      };
      const queue = { add: jest.fn().mockResolvedValue({ id: "bull-1" }) };
      const reconciler = new OutboxDispatcher(
        repository as any,
        httpService,
        configService,
        queue as any,
      );

      await reconciler.reconcile();

      expect(queue.add).toHaveBeenCalledWith(
        "dispatch-outbox",
        { eventId: "event-reconcile-1" },
        expect.objectContaining({ jobId: "dispatch-outbox-event-reconcile-1" }),
      );
      expect(repository.releaseOutboxClaim).toHaveBeenCalledWith(
        "event-reconcile-1",
        expect.stringContaining("publication-reconciler:"),
      );
    });

    it("returns Redis failures to DB backoff instead of losing the event", async () => {
      const repository = {
        claimDueOutboxEvents: jest
          .fn()
          .mockResolvedValue([{ eventId: "event-reconcile-2" }]),
        releaseOutboxClaim: jest.fn().mockResolvedValue(true),
      };
      const queue = {
        add: jest.fn().mockRejectedValue(new Error("Redis unavailable")),
      };
      const reconciler = new OutboxDispatcher(
        repository as any,
        httpService,
        configService,
        queue as any,
      );

      await reconciler.reconcile();

      expect(repository.releaseOutboxClaim).toHaveBeenCalledWith(
        "event-reconcile-2",
        expect.stringContaining("publication-reconciler:"),
        "Redis unavailable",
      );
    });
  });
});
