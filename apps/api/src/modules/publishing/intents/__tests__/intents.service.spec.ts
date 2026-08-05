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
    const service = new IntentsService(prisma, queue, {} as any);

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
        priority: 0,
      },
    );
    expect(queue.add.mock.calls[0][2].jobId).not.toBe(
      `publish:${intent.id}:${intent.version}`,
    );
  });
});

describe("IntentsService.dispatchExport", () => {
  it("records EXPORTED only after the real archive is stored", async () => {
    const intent = {
      id: "11111111-1111-4111-8111-111111111111",
      businessId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      candidateId: "22222222-2222-4222-8222-222222222222",
      version: 1,
      status: "DRAFT",
      mode: "MANUAL_EXPORT",
      targetId: null,
      scheduledLocalAt: null,
      timezone: null,
      scheduledUtcAt: null,
      approvedDecisionId: null,
      createdByUserId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      createdAt: new Date(),
      updatedAt: new Date(),
      candidate: {
        status: "ACTIVE",
        candidateChecksum: "a".repeat(64),
        payload: {
          contract_version: "publication-candidate-v1",
          candidate_id: "22222222-2222-4222-8222-222222222222",
        },
      },
    };
    const attempt = { id: "attempt-1", status: "SUCCEEDED" };
    const result = { id: "result-1", outcome: "EXPORTED" };
    const updated = { ...intent, status: "SUCCEEDED" };
    const tx = {
      publishingIntent: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(intent),
        update: jest
          .fn()
          .mockResolvedValueOnce({ ...intent, status: "DISPATCHING" })
          .mockResolvedValueOnce(updated),
      },
      publishingAttempt: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(attempt),
      },
      publishingExportMetadata: {
        create: jest.fn().mockResolvedValue({}),
      },
      publishingResult: {
        create: jest.fn().mockResolvedValue(result),
      },
    };
    const prisma = {
      $transaction: jest.fn(async (cb: (client: any) => unknown) => cb(tx)),
    } as any;
    const archive = {
      createArchive: jest.fn().mockReturnValue({
        artifactId: "33333333-3333-4333-8333-333333333333",
        checksum: "b".repeat(64),
        destinationRef:
          "publishing-export:33333333-3333-4333-8333-333333333333",
        fileName: "33333333-3333-4333-8333-333333333333.tar.gz",
        mimeType: "application/gzip",
      }),
    } as any;
    const service = new IntentsService(prisma, {} as any, archive);

    const response = await service.dispatchExport(
      intent.id,
      intent.businessId,
      intent.createdByUserId,
      { idempotencyKey: "export-action-1" },
    );

    expect(archive.createArchive).toHaveBeenCalledWith(
      expect.objectContaining({
        intentId: intent.id,
        candidate: intent.candidate.payload,
      }),
    );
    expect(tx.publishingExportMetadata.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        exportType: "manual_archive_targz",
        checksum: "b".repeat(64),
      }),
    });
    expect(tx.publishingResult.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        outcome: "EXPORTED",
        retryable: false,
      }),
    });
    expect(response.intent.status).toBe("SUCCEEDED");
    expect(response.attempt.result).toBe(result);
  });
});
