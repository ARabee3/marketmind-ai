/**
 * Double-dispatch race condition unit tests — §7.2 / §13 of the implementation plan.
 *
 * Verifies that:
 *  - the atomic claim step (`UPDATE ... WHERE status='QUEUED'`) strictly
 *    prevents a stalled-job redelivery from dispatching the same attempt twice;
 *  - the canonical request-fingerprint replay check (inside the revalidation
 *    transaction) resolves an identical replay to the existing attempt (no-op)
 *    and rejects a conflicting replay (never calling n8n).
 */

import { DispatchProcessor } from "../dispatch.processor";
import { N8nClientService } from "../n8n-client.service";
import { AssetIntegrityValidator } from "../asset-integrity-validator";
import { PrismaService } from "../../../../common/persistence/prisma.service";
import { Job } from "bullmq";
import * as crypto from "crypto";

describe("DispatchProcessor — Double-dispatch race protection", () => {
  let processor: DispatchProcessor;
  let prisma: jest.Mocked<Partial<PrismaService>>;
  let n8n: jest.Mocked<Partial<N8nClientService>>;
  let assetIntegrity: jest.Mocked<Partial<AssetIntegrityValidator>>;
  let mockJob: Job;

  const scheduledUtcAt = new Date("2026-01-01T00:00:00.000Z");
  const intent = {
    version: 1,
    status: "SCHEDULED",
    scheduledUtcAt,
    mode: "REAL",
    candidateId: "c-1",
    targetId: "t-1",
  };
  const EXPECTED_FINGERPRINT = crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        intentId: "intent-1",
        version: 1,
        candidateId: "c-1",
        targetId: "t-1",
        mode: "REAL",
        scheduledUtcAt: scheduledUtcAt.toISOString(),
      }),
    )
    .digest("hex");

  /** Re-mock $transaction so the tx exposes an existing-attempt replay lookup. */
  function mockTxWithExistingAttempt(fingerprint: string): void {
    (prisma.$transaction as jest.Mock).mockImplementation(
      async (cb: (tx: any) => unknown) =>
        cb({
          publishingIntent: {
            findUniqueOrThrow: jest.fn().mockResolvedValue(intent),
            update: jest.fn(),
          },
          publishingAttempt: {
            findUnique: jest.fn().mockResolvedValue({
              id: "attempt-1",
              status: "SUCCEEDED",
              providerRequestFingerprint: fingerprint,
            }),
            findFirst: jest.fn().mockResolvedValue(null),
          },
        }),
    );
  }

  beforeEach(() => {
    prisma = {
      $transaction: jest.fn().mockImplementation(async (cb) => {
        return cb({
          publishingIntent: {
            findUniqueOrThrow: jest.fn().mockResolvedValue(intent),
            update: jest.fn().mockResolvedValue({}),
          },
          publishingApproval: {
            findFirst: jest
              .fn()
              .mockResolvedValue({
                intentVersionAtDecision: 1,
                decision: "APPROVED",
                candidateChecksum: "chk123",
              }),
          },
          publishingCandidate: {
            findUniqueOrThrow: jest
              .fn()
              .mockResolvedValue({
                id: "c-1",
                status: "ACTIVE",
                candidateChecksum: "chk123",
                payload: {},
              }),
          },
          publishingTarget: {
            findUniqueOrThrow: jest
              .fn()
              .mockResolvedValue({
                id: "t-1",
                connectionState: "CONNECTED",
                credentialRef: "cred-1",
              }),
          },
          publishingAttempt: {
            findUnique: jest.fn().mockResolvedValue(null),
            findFirst: jest.fn().mockResolvedValue(null),
            create: jest
              .fn()
              .mockResolvedValue({ id: "attempt-1", status: "QUEUED" }),
            update: jest.fn().mockResolvedValue({}),
          },
        });
      }),
      publishingAttempt: {
        // Atomic claim runs outside the transaction.
        updateMany: jest.fn(),
      } as any,
    };

    n8n = {
      dispatch: jest.fn().mockResolvedValue({ executionId: "exec-1" }),
    };

    assetIntegrity = {
      validateForDispatch: jest.fn().mockResolvedValue(undefined),
    };

    processor = new DispatchProcessor(
      prisma as any,
      n8n as any,
      assetIntegrity as any,
    );
    mockJob = {
      data: { intentId: "intent-1", version: 1, idempotencyKey: "key-1" },
    } as any;

    jest.spyOn(processor["logger"], "log").mockImplementation(() => {});
    jest.spyOn(processor["logger"], "warn").mockImplementation(() => {});
    jest.spyOn(processor["logger"], "error").mockImplementation(() => {});
  });

  it("proceeds to call n8n when atomic claim succeeds (count === 1)", async () => {
    (prisma.publishingAttempt!.updateMany as jest.Mock).mockResolvedValue({
      count: 1,
    });

    await processor.process(mockJob);

    expect(prisma.publishingAttempt!.updateMany).toHaveBeenCalledWith({
      where: { id: "attempt-1", status: "QUEUED" },
      data: { status: "DISPATCHING" },
    });
    expect(n8n.dispatch).toHaveBeenCalled(); // n8n was called!
    expect(assetIntegrity.validateForDispatch).toHaveBeenCalled(); // asset hook invoked for REAL mode
  });

  it("stops and DOES NOT call n8n when atomic claim fails (count === 0)", async () => {
    (prisma.publishingAttempt!.updateMany as jest.Mock).mockResolvedValue({
      count: 0,
    });

    await processor.process(mockJob);

    expect(prisma.publishingAttempt!.updateMany).toHaveBeenCalledWith({
      where: { id: "attempt-1", status: "QUEUED" },
      data: { status: "DISPATCHING" },
    });
    expect(n8n.dispatch).not.toHaveBeenCalled();
  });

  it("records a no-op when the same idempotency key+bytes replayed (resolves to existing attempt)", async () => {
    mockTxWithExistingAttempt(EXPECTED_FINGERPRINT);

    await processor.process(mockJob);

    // Replay MUST NOT call n8n again and MUST NOT attempt a 2nd atomic claim.
    expect(n8n.dispatch).not.toHaveBeenCalled();
    expect(prisma.publishingAttempt!.updateMany).not.toHaveBeenCalled();
  });

  it("rejects a replay whose canonical bytes differ under the same idempotency key", async () => {
    mockTxWithExistingAttempt("different-fingerprint");

    // The processor catches revalidation failures and marks the intent failed —
    // it must never call n8n on a conflicting replay.
    await processor.process(mockJob);

    expect(n8n.dispatch).not.toHaveBeenCalled();
    expect(prisma.publishingAttempt!.updateMany).not.toHaveBeenCalled();
  });
});
