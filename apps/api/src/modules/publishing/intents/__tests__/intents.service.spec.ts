import { IntentsService } from "../intents.service";

describe("IntentsService.retryIntent", () => {
  it("uses a new stable BullMQ job id instead of the retained original job id", async () => {
    const scheduledUtcAt = new Date(Date.now() - 1_000);
    const intent = {
      id: "11111111-1111-4111-8111-111111111111",
      businessId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      version: 3,
      status: "FAILED",
      scheduledUtcAt,
      scheduledLocalAt: scheduledUtcAt,
      timezone: "Africa/Cairo",
      approvals: [{ intentVersionAtDecision: 3 }],
      attempts: [{ status: "FAILED", attemptSequence: 2 }],
    };
    const updated = { ...intent, status: "SCHEDULED" };
    const prisma = {
      $transaction: jest.fn(async (cb: (tx: any) => unknown) =>
        cb({
          publishingIntent: {
            findUniqueOrThrow: jest.fn().mockResolvedValue(intent),
            update: jest.fn().mockResolvedValue(updated),
          },
        }),
      ),
    } as any;
    const queue = {
      add: jest.fn().mockResolvedValue({}),
    } as any;
    const service = new IntentsService(prisma, queue);

    await service.retryIntent(intent.id, intent.businessId, {
      currentVersion: 3,
      expectedLastAttemptNumber: 2,
      idempotencyKey: "owner-retry-action-1",
    });

    expect(queue.add).toHaveBeenCalledWith(
      "dispatch",
      {
        intentId: intent.id,
        version: intent.version,
        idempotencyKey: "owner-retry-action-1::dispatch",
      },
      {
        delay: 0,
        jobId: expect.stringMatching(
          new RegExp(`^publishing-retry-${intent.id}-v3-[a-f0-9]{64}$`),
        ),
      },
    );
    expect(queue.add.mock.calls[0][2].jobId).not.toBe(
      `publish:${intent.id}:${intent.version}`,
    );
  });
});
