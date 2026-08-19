import { Test, TestingModule } from "@nestjs/testing";
import { getQueueToken } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { Prisma } from "@prisma/client";

import { BillingOutboxReconciler } from "./billing-outbox.reconciler";
import { BillingOutboxRepository } from "./billing-outbox.repository";

type OutboxRow = Prisma.BillingOutboxGetPayload<Record<string, never>>;

const buildEvent = (id: string): OutboxRow =>
  ({
    id,
    billingAccountId: "account-1",
    eventType: "billing.payment_confirmed",
    dedupeKey: `fake:${id}`,
    payload: {},
    state: "processing",
    attempts: 0,
    leaseOwner: "lease-1",
    leaseExpiresAt: new Date(),
    nextAttemptAt: null,
    lastError: null,
    dispatchedAt: null,
    createdAt: new Date(),
  }) as unknown as OutboxRow;

describe("BillingOutboxReconciler", () => {
  let reconciler: BillingOutboxReconciler;
  let outbox: {
    claimDueEvents: jest.Mock;
    releaseClaim: jest.Mock;
    releaseForRetry: jest.Mock;
  };
  let queue: { add: jest.Mock };

  beforeEach(async () => {
    outbox = {
      claimDueEvents: jest.fn().mockResolvedValue([]),
      releaseClaim: jest.fn().mockResolvedValue(true),
      releaseForRetry: jest.fn().mockResolvedValue(true),
    };
    queue = { add: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BillingOutboxReconciler,
        { provide: BillingOutboxRepository, useValue: outbox },
        { provide: getQueueToken("billing-outbox"), useValue: queue },
      ],
    }).compile();

    reconciler = module.get<BillingOutboxReconciler>(BillingOutboxReconciler);
  });

  afterEach(() => jest.clearAllMocks());

  it("enqueues claimed events and releases the claim for the worker", async () => {
    outbox.claimDueEvents.mockResolvedValue([buildEvent("event-1")]);

    await reconciler.reconcile();

    expect(outbox.claimDueEvents).toHaveBeenCalledWith(
      expect.stringContaining("billing-mail-reconciler:"),
    );
    expect(queue.add).toHaveBeenCalledWith(
      "dispatch-billing-email",
      { eventId: "event-1" },
      expect.objectContaining({
        jobId: "billing-email-event-1",
        attempts: 3,
      }),
    );
    expect(outbox.releaseClaim).toHaveBeenCalledWith(
      "event-1",
      expect.stringContaining("billing-mail-reconciler:"),
    );
  });

  it("releases for retry when the queue add fails", async () => {
    outbox.claimDueEvents.mockResolvedValue([buildEvent("event-1")]);
    queue.add.mockRejectedValue(new Error("Redis down"));

    await reconciler.reconcile();

    expect(outbox.releaseForRetry).toHaveBeenCalledWith(
      "event-1",
      expect.stringContaining("billing-mail-reconciler:"),
      "Redis down",
    );
    expect(outbox.releaseClaim).not.toHaveBeenCalled();
  });
});
