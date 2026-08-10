import { IntentsService } from "../intents.service";
import { PublishingMode } from "../intents.dto";

describe("IntentsService.createIntent", () => {
  const candidateId = "22222222-2222-4222-8222-222222222222";
  const businessId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

  function context(existingReal: unknown = null) {
    const created = {
      id: "11111111-1111-4111-8111-111111111111",
      candidateId,
      businessId,
      mode: "REAL",
      status: "DRAFT",
    };
    const tx = {
      publishingCandidate: {
        findUnique: jest.fn().mockResolvedValue({
          businessId,
          status: "ACTIVE",
        }),
      },
      publishingIntent: {
        findFirst: jest.fn().mockResolvedValue(existingReal),
        create: jest.fn().mockResolvedValue(created),
      },
    };
    const prisma = {
      publishingIntent: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn(async (cb: (client: typeof tx) => unknown) =>
        cb(tx),
      ),
    } as any;
    return {
      service: new IntentsService(prisma, {} as any, {} as any),
      tx,
    };
  }

  it("allows local export and simulation intents without consuming the real slot", async () => {
    for (const mode of [
      PublishingMode.MANUAL_EXPORT,
      PublishingMode.SIMULATION,
    ]) {
      const { service, tx } = context();
      await service.createIntent(businessId, "owner-1", {
        candidateId,
        mode,
        idempotencyKey: `create-${mode}`,
      });
      expect(tx.publishingIntent.findFirst).not.toHaveBeenCalled();
      expect(tx.publishingIntent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ candidateId, mode }),
      });
    }
  });

  it("checks only existing REAL lifecycles before creating a real intent", async () => {
    const { service, tx } = context();
    await service.createIntent(businessId, "owner-1", {
      candidateId,
      mode: PublishingMode.REAL,
      idempotencyKey: "create-real",
    });
    expect(tx.publishingIntent.findFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({
        businessId,
        candidateId,
        mode: "REAL",
      }),
    });
  });
});

describe("IntentsService.getIntent", () => {
  it("projects the candidate checksum required by the approval contract", async () => {
    const prisma = {
      publishingIntent: {
        findFirst: jest.fn().mockResolvedValue({
          id: "11111111-1111-4111-8111-111111111111",
          businessId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          candidateId: "22222222-2222-4222-8222-222222222222",
          version: 2,
          mode: "REAL",
          status: "AWAITING_APPROVAL",
          candidate: {
            candidateChecksum: "a".repeat(64),
            payload: { caption: "private candidate relation" },
          },
          target: null,
          approvals: [],
        }),
      },
    } as any;
    const service = new IntentsService(prisma, {} as any, {} as any);

    const result = await service.getIntent(
      "11111111-1111-4111-8111-111111111111",
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    );

    expect(result.candidateChecksum).toBe("a".repeat(64));
    expect(result.candidate).toBeUndefined();
  });
});

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
        manifest: {
          contract_version: "publishing-export-manifest-v1",
          artifact_id: "33333333-3333-4333-8333-333333333333",
          label: "EXPORTED_NOT_PUBLISHED",
        },
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
        manifest: {
          contract_version: "publishing-export-manifest-v1",
          artifact_id: "33333333-3333-4333-8333-333333333333",
          label: "EXPORTED_NOT_PUBLISHED",
        },
      }),
    });
    expect(tx.publishingAttempt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        providerRequestFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
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

describe("IntentsService.getExportMetadata", () => {
  it("returns the singular frozen export response", async () => {
    const exportedAt = new Date("2026-08-05T10:00:00.000Z");
    const artifactId = "33333333-3333-4333-8333-333333333333";
    const prisma = {
      publishingIntent: {
        findFirst: jest.fn().mockResolvedValue({
          id: "11111111-1111-4111-8111-111111111111",
          businessId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        }),
      },
      publishingExportMetadata: {
        findFirst: jest.fn().mockResolvedValue({
          destinationRef: `publishing-export:${artifactId}`,
          manifest: {
            contract_version: "publishing-export-manifest-v1",
            artifact_id: artifactId,
          },
          exportedAt,
        }),
      },
    } as any;
    const service = new IntentsService(prisma, {} as any, {} as any);

    await expect(
      service.getExportMetadata(
        "11111111-1111-4111-8111-111111111111",
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      ),
    ).resolves.toEqual({
      artifact_id: artifactId,
      manifest: {
        contract_version: "publishing-export-manifest-v1",
        artifact_id: artifactId,
      },
      download_url:
        "/api/v1/publication-intents/11111111-1111-4111-8111-111111111111/export/download",
      download_expires_at: new Date(
        exportedAt.getTime() + 24 * 60 * 60 * 1000,
      ).toISOString(),
    });
  });
});
