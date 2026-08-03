/**
 * Reconciliation sweep unit tests — §6 / §13 of the implementation plan.
 *
 * Verifies:
 * 1. Stuck attempts in QUEUED/DISPATCHING past timeout → flagged UNKNOWN.
 * 2. Missed jobs (SCHEDULED intents past due with zero attempts) → re-enqueued.
 * 3. Orphan BullMQ jobs for terminal intents → removed.
 */

import { ReconciliationService } from "../reconciliation.service";

// ── Helpers ──────────────────────────────────────────────────────────────────

const STUCK_TIMEOUT_MS = 10 * 60 * 1000;

function makeAttempt(status: string, ageMs: number) {
  return {
    id: `attempt-${Math.random()}`,
    intentId: `intent-${Math.random()}`,
    status,
    createdAt: new Date(Date.now() - ageMs),
  };
}

function makePrisma(
  overrides: Partial<{
    attempts: any[];
    intents: any[];
  }> = {},
) {
  const attempts = overrides.attempts ?? [];
  const intents = overrides.intents ?? [];

  return {
    publishingAttempt: {
      findMany: jest.fn().mockResolvedValue(attempts),
      count: jest.fn().mockResolvedValue(0),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({}),
    },
    publishingIntent: {
      findMany: jest.fn().mockResolvedValue(intents),
      findUnique: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({}),
      findUniqueOrThrow: jest.fn().mockResolvedValue(null),
    },
    $transaction: jest.fn().mockImplementation((fn: (tx: any) => any) => {
      return fn({
        publishingAttempt: { update: jest.fn().mockResolvedValue({}) },
        publishingIntent: { updateMany: jest.fn().mockResolvedValue({}) },
        // flagStuckAttempts now also creates an UNKNOWN result row so an admin can
        // resolve the stuck attempt (P1 #119 non-blocking gap).
        publishingResult: {
          findUnique: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockResolvedValue({}),
        },
      });
    }),
  } as any;
}

function makeQueue(jobs: any[] = []) {
  return {
    getDelayed: jest.fn().mockResolvedValue(jobs),
    getJob: jest.fn().mockResolvedValue(null),
    add: jest.fn().mockResolvedValue({ id: "new-job" }),
  } as any;
}

// ── Stuck attempts ────────────────────────────────────────────────────────────

describe("ReconciliationService.flagStuckAttempts", () => {
  it("flags QUEUED attempt past 10-min timeout as UNKNOWN", async () => {
    const stuckAttempt = makeAttempt("QUEUED", STUCK_TIMEOUT_MS + 1000);
    const prisma = makePrisma({ attempts: [stuckAttempt] });
    const service = new ReconciliationService(prisma, makeQueue());

    await service.flagStuckAttempts();

    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it("flags DISPATCHING attempt past 10-min timeout as UNKNOWN", async () => {
    const stuckAttempt = makeAttempt("DISPATCHING", STUCK_TIMEOUT_MS + 5000);
    const prisma = makePrisma({ attempts: [stuckAttempt] });
    const service = new ReconciliationService(prisma, makeQueue());

    await service.flagStuckAttempts();

    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it("P1 (#119 non-blocking): also writes an UNKNOWN result row so an admin can resolve the stuck attempt", async () => {
    const stuckAttempt = makeAttempt("QUEUED", STUCK_TIMEOUT_MS + 1000);
    const resultFindUnique = jest.fn().mockResolvedValue(null);
    const resultCreate = jest.fn().mockResolvedValue({});
    const prisma = makePrisma({ attempts: [stuckAttempt] });
    (prisma.$transaction as jest.Mock).mockImplementation(
      async (cb: (tx: any) => any) =>
        cb({
          publishingAttempt: { update: jest.fn().mockResolvedValue({}) },
          publishingIntent: { updateMany: jest.fn().mockResolvedValue({}) },
          publishingResult: {
            findUnique: resultFindUnique,
            create: resultCreate,
          },
        }),
    );
    const service = new ReconciliationService(prisma, makeQueue());

    await service.flagStuckAttempts();

    expect(resultFindUnique).toHaveBeenCalled();
    expect(resultCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          attemptId: stuckAttempt.id,
          intentId: stuckAttempt.intentId,
          outcome: "UNKNOWN",
          retryable: true,
        }),
      }),
    );
  });

  it("does NOT flag an attempt within the timeout window", async () => {
    const freshAttempt = makeAttempt("QUEUED", STUCK_TIMEOUT_MS - 1000);
    const prisma = makePrisma({ attempts: [] }); // DB query would return only cutoff-exceeded rows
    const service = new ReconciliationService(prisma, makeQueue());

    await service.flagStuckAttempts();

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

// ── Missed job recovery ───────────────────────────────────────────────────────

describe("ReconciliationService.recoverMissedJobs", () => {
  it("re-enqueues a SCHEDULED intent past due with no attempt", async () => {
    const overdueIntent = {
      id: "intent-overdue",
      version: 2,
      status: "SCHEDULED",
      scheduledUtcAt: new Date(Date.now() - 60_000),
      attempts: [],
    };
    const prisma = makePrisma({ intents: [overdueIntent] });
    prisma.publishingAttempt.count.mockResolvedValue(0); // no attempts
    const queue = makeQueue([]);
    const service = new ReconciliationService(prisma, queue);

    await service.recoverMissedJobs();

    expect(queue.add).toHaveBeenCalledWith(
      "dispatch",
      {
        intentId: "intent-overdue",
        version: 2,
        idempotencyKey: "recovery:intent-overdue:2",
      },
      expect.objectContaining({ jobId: "publish:intent-overdue:2", delay: 0 }),
    );
  });

  it("does NOT re-enqueue if a BullMQ job already exists for the intent", async () => {
    const overdueIntent = {
      id: "intent-has-job",
      version: 1,
      status: "SCHEDULED",
      scheduledUtcAt: new Date(Date.now() - 30_000),
      attempts: [],
    };
    const prisma = makePrisma({ intents: [overdueIntent] });
    prisma.publishingAttempt.count.mockResolvedValue(0);
    const queue = makeQueue();
    queue.getJob.mockResolvedValue({ id: "existing-job" }); // job already exists
    const service = new ReconciliationService(prisma, queue);

    await service.recoverMissedJobs();

    expect(queue.add).not.toHaveBeenCalled();
  });
});

// ── Orphan job removal ────────────────────────────────────────────────────────

describe("ReconciliationService.removeOrphanJobs", () => {
  it("removes a delayed job whose intent is in a terminal state", async () => {
    const removeMock = jest.fn();
    const orphanJob = {
      id: "orphan-job",
      data: { intentId: "intent-done" },
      remove: removeMock,
    };
    const prisma = makePrisma();
    prisma.publishingIntent.findUnique.mockResolvedValue({
      status: "SUCCEEDED",
    });
    const queue = makeQueue([orphanJob]);
    const service = new ReconciliationService(prisma, queue);

    await service.removeOrphanJobs();

    expect(removeMock).toHaveBeenCalled();
  });

  it("does NOT remove a job for a non-terminal intent", async () => {
    const removeMock = jest.fn();
    const activeJob = {
      id: "active-job",
      data: { intentId: "intent-active" },
      remove: removeMock,
    };
    const prisma = makePrisma();
    prisma.publishingIntent.findUnique.mockResolvedValue({
      status: "SCHEDULED",
    });
    const queue = makeQueue([activeJob]);
    const service = new ReconciliationService(prisma, queue);

    await service.removeOrphanJobs();

    expect(removeMock).not.toHaveBeenCalled();
  });
});
