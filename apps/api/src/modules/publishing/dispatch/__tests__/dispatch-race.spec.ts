/**
 * DispatchProcessor race-condition unit tests — §7.2 / §13.
 *
 * Verifies:
 *  - a fresh dispatch with a successful atomic claim calls n8n with the frozen
 *    SignedPublicationDispatchEnvelopeV1 body and flips the intent DISPATCHING;
 *  - a lost atomic claim does NOT call n8n;
 *  - a replay of an existing (intent, idempotency_key) attempt is a recorded
 *    no-op (no claim, no n8n) even after the intent moved to a terminal state.
 */

import { DispatchProcessor } from "../dispatch.processor";
import { N8nClientService } from "../n8n-client.service";
import { AssetIntegrityValidator } from "../asset-integrity-validator";
import { DispatchEnvelopeBuilder } from "../dispatch-envelope.builder";
import { PrismaService } from "../../../../common/persistence/prisma.service";
import { ConfigService } from "@nestjs/config";
import type { PublicationDispatchBodyV1 } from "@marketmind/contracts";

/** Build a valid frozen dispatch body once via the real builder, to use as the
 *  revalidation-tx result in process() tests. */
function buildBody(): PublicationDispatchBodyV1 {
  const config = {
    get: (k: string) =>
      k === "publishing.callbackBaseUrl"
        ? "http://localhost:3001"
        : k === "publishing.n8nSigningKeyId"
          ? "kid-1"
          : k === "publishing.workflowVersion"
            ? "v1"
            : "",
  } as unknown as ConfigService;
  const builder = new DispatchEnvelopeBuilder(config);
  const scheduledUtcAt = new Date("2026-08-03T18:00:00.000Z");
  return builder.buildDispatchBody({
    attemptId: "11111100-0000-4000-8000-000000000010",
    intentId: "11111100-0000-4000-8000-000000000002",
    intentVersion: 1,
    businessId: "aaaaaaaa-aaaa-4000-8000-aaaaaaaaaaaa",
    idempotencyKey: "key-1::dispatch",
    candidate: {
      contract_version: "publication-candidate-v1",
      candidate_id: "11111100-0000-4000-8000-000000000001",
      business_id: "aaaaaaaa-aaaa-4000-8000-aaaaaaaaaaaa",
      strategy_id: "22222222-2222-4222-8222-222222222222",
      strategy_version: 1,
      content_cycle_id: "33333333-3333-4333-8333-333333333333",
      strategy_week_number: 1,
      content_pack_id: "77777777-7777-4777-8777-777777777777",
      content_item_id: "88888888-8888-4888-8888-888888888888",
      content_item_version_id: "99999999-9999-4999-8999-999999999999",
      content_item_version: 1,
      content_item_version_checksum: "item-version-checksum-week-1-ar",
      target_channel: "facebook",
      content_format: "static_image_post",
      selected_locale: "ar",
      caption: "caption",
      cta: null,
      hashtags: [],
      alt_text: "alt",
      assets: [
        {
          asset_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          kind: "owner_supplied",
          mime_type: "image/jpeg",
          storage_key: "content/k.jpg",
          checksum:
            "101954615d862e6921a9fb7e2f5866170d3d375d6e8eb4a7443ea1e30cd2a0e4",
        },
      ],
      recommended_publish_window: {
        starts_at: "2026-08-03T18:00:00+03:00",
        ends_at: "2026-08-03T21:00:00+03:00",
        timezone: "Africa/Cairo",
      },
      approval: {
        decision_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        decision: "approved",
        content_item_version_id: "99999999-9999-4999-8999-999999999999",
        content_item_version_checksum: "item-version-checksum-week-1-ar",
        decided_by_user_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        decided_at: "2026-08-01T11:00:00+03:00",
      },
      candidate_checksum:
        "b5c1c475672658d5f3760f54b2969428544ca3bcf619c8c998a922485b3b3443",
      created_at: "2026-08-01T11:01:00+03:00",
    } as never,
    candidateStatus: {
      contract_version: "publication-candidate-status-v1",
      candidate_id: "11111100-0000-4000-8000-000000000001",
      business_id: "aaaaaaaa-aaaa-4000-8000-aaaaaaaaaaaa",
      candidate_checksum:
        "b5c1c475672658d5f3760f54b2969428544ca3bcf619c8c998a922485b3b3443",
      state_version: 1,
      candidate_state: "active",
      replacement_candidate_id: null,
      changed_by_user_id: null,
      changed_at: "2026-08-01T11:01:01+03:00",
    } as never,
    target: {
      id: "77777700-0000-4000-8000-000000000001",
      businessId: "aaaaaaaa-aaaa-4000-8000-aaaaaaaaaaaa",
      provider: "META",
      channel: "facebook",
      externalAccountId: "fb-acct",
      displayName: "Acme Page",
      connectionState: "CONNECTED",
      credentialRef: "cred-ref",
      capabilities: ["static_image"],
      lastVerifiedAt: null,
      version: 1,
    },
    approval: {
      id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      candidateChecksum:
        "b5c1c475672658d5f3760f54b2969428544ca3bcf619c8c998a922485b3b3443",
      decidedByUserId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      decidedAt: new Date("2026-08-01T11:00:00+03:00"),
    },
    scheduledUtcAt,
    scheduledLocalAt: new Date("2026-08-03T18:00:00.000Z"),
    timezone: "Africa/Cairo",
  }).body;
}

describe("DispatchProcessor — race protection (frozen envelope P1)", () => {
  let processor: DispatchProcessor;
  let prisma: jest.Mocked<Partial<PrismaService>>;
  let n8n: jest.Mocked<Partial<N8nClientService>>;
  let assetIntegrity: jest.Mocked<Partial<AssetIntegrityValidator>>;
  const body = buildBody();

  beforeEach(() => {
    prisma = {
      $transaction: jest.fn().mockResolvedValue({
        replayed: false,
        attemptId: "attempt-1",
        status: "QUEUED",
        body,
      }),
      publishingAttempt: {
        updateMany: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      } as any,
      publishingIntent: {
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      } as any,
    } as any;

    n8n = { dispatch: jest.fn().mockResolvedValue({ executionId: "exec-1" }) };
    assetIntegrity = {
      validateForDispatch: jest.fn().mockResolvedValue(undefined),
    };

    processor = new DispatchProcessor(
      prisma as any,
      n8n as any,
      assetIntegrity as any,
      // envelopeBuilder is not exercised here (the tx result is mocked), but the
      // constructor still needs a real instance.
      new DispatchEnvelopeBuilder({ get: () => "" } as any),
    );
    jest.spyOn(processor["logger"], "log").mockImplementation(() => {});
    jest.spyOn(processor["logger"], "warn").mockImplementation(() => {});
    jest.spyOn(processor["logger"], "error").mockImplementation(() => {});
  });

  const job = {
    data: { intentId: "i-1", version: 1, idempotencyKey: "k-1" },
  } as any;

  it("proceeds to n8n with the frozen dispatch body when the atomic claim wins", async () => {
    (prisma.publishingAttempt!.updateMany as jest.Mock).mockResolvedValue({
      count: 1,
    });

    await processor.process(job);

    // n8n received the frozen SignedPublicationDispatchEnvelopeV1 body.
    expect(n8n.dispatch).toHaveBeenCalledTimes(1);
    expect((n8n.dispatch as jest.Mock).mock.calls[0][0]).toBe(body);
    // Asset integrity ran for the REAL dispatch body's candidate.
    expect(assetIntegrity.validateForDispatch).toHaveBeenCalled();
  });

  it("does NOT call n8n when the atomic claim loses (count === 0)", async () => {
    (prisma.publishingAttempt!.updateMany as jest.Mock).mockResolvedValue({
      count: 0,
    });

    await processor.process(job);

    expect(n8n.dispatch).not.toHaveBeenCalled();
  });

  it("records a no-op for a replayed (intent, idempotency_key) attempt — no claim, no n8n", async () => {
    (prisma.$transaction as jest.Mock).mockResolvedValue({
      replayed: true,
      attemptId: "attempt-1",
      status: "SUCCEEDED",
      body: null,
    });

    await processor.process(job);

    expect(n8n.dispatch).not.toHaveBeenCalled();
    expect(prisma.publishingAttempt!.updateMany).not.toHaveBeenCalled();
    expect(assetIntegrity.validateForDispatch).not.toHaveBeenCalled();
  });

  it("P1-6: a stale vN revalidation failure does NOT fail a newer vN+1 intent — markIntentFailed is version-predicated (0 rows)", async () => {
    // Simulate the revalidation tx rejecting because the job's version (1) is
    // stale against the current intent version (2). markIntentFailed must
    // update ONLY rows where version === 1 — there are none, so the newer
    // SCHEDULED intent is untouched.
    jest
      .spyOn(processor as never, "runRevalidationAndCreateAttempt" as never)
      .mockRejectedValue(
        new Error(
          "PUBLISHING_STATE_CONFLICT: intent version mismatch (expected 1, current 2)",
        ) as never,
      );
    (prisma.publishingIntent!.updateMany as jest.Mock).mockResolvedValue({
      count: 0,
    });

    await processor.process(job);

    expect(prisma.publishingIntent!.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "i-1",
          version: 1,
          status: { in: ["SCHEDULED", "DISPATCHING"] },
        }),
        data: { status: "FAILED" },
      }),
    );
    // A stale job must not touch a different/current intent version.
    expect(
      (prisma.publishingIntent!.updateMany as jest.Mock).mock.calls[0][0].where
        .version,
    ).toBe(1);
  });

  it("P1-7: an ambiguous n8n delivery (timeout) persists UNKNOWN + ACTION_REQUIRED and a result row — never a blind FAILED retry", async () => {
    // Revalidation returns a fresh REAL attempt; asset integrity passes; the
    // atomic claim wins; n8n then times out ambiguously.
    jest
      .spyOn(processor as never, "runRevalidationAndCreateAttempt" as never)
      .mockResolvedValue({
        replayed: false,
        attemptId: "attempt-1",
        status: "QUEUED",
        body,
      } as never);
    (prisma.publishingAttempt!.updateMany as jest.Mock).mockResolvedValue({
      count: 1,
    });
    const axiosTimeout: Error & {
      code?: string;
      isAxiosError?: boolean;
    } = new Error("timeout of 15000ms exceeded");
    axiosTimeout.code = "ECONNABORTED";
    axiosTimeout.isAxiosError = true;
    (n8n.dispatch as jest.Mock).mockRejectedValue(axiosTimeout);

    // Track the post-failure write transaction.
    const attemptUpdate = jest.fn().mockResolvedValue({});
    const resultFindUnique = jest.fn().mockResolvedValue(null);
    const resultCreate = jest.fn().mockResolvedValue({});
    const intentUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
    (prisma.$transaction as jest.Mock).mockImplementation(
      async (cb: (tx: any) => any) =>
        cb({
          publishingAttempt: { update: attemptUpdate },
          publishingResult: {
            findUnique: resultFindUnique,
            create: resultCreate,
          },
          publishingIntent: { updateMany: intentUpdateMany },
        }),
    );

    await processor.process(job);

    // Ambiguous → attempt UNKNOWN, intent ACTION_REQUIRED (version-predicated),
    // and a matching UNKNOWN result row for reconciliation/admin resolution.
    expect(attemptUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "UNKNOWN" }),
      }),
    );
    expect(intentUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "i-1",
          version: 1,
          status: { in: ["SCHEDULED", "DISPATCHING"] },
        }),
        data: { status: "ACTION_REQUIRED" },
      }),
    );
    expect(resultCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          outcome: "UNKNOWN",
          errorCode: "PUBLISHING_PROVIDER_OUTCOME_UNKNOWN",
          retryable: false,
        }),
      }),
    );
  });

  it("persists the workflow version sent in the frozen dispatch body", async () => {
    const attemptUpdate = jest.fn().mockResolvedValue({});
    const tx = {
      publishingIntent: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: "11111100-0000-4000-8000-000000000002",
          version: 1,
          status: "SCHEDULED",
          candidateId: "11111100-0000-4000-8000-000000000001",
          targetId: "77777700-0000-4000-8000-000000000001",
          businessId: "aaaaaaaa-aaaa-4000-8000-aaaaaaaaaaaa",
          scheduledUtcAt: new Date("2026-08-03T18:00:00.000Z"),
          scheduledLocalAt: new Date("2026-08-03T18:00:00.000Z"),
          timezone: "Africa/Cairo",
        }),
      },
      publishingApproval: {
        findFirst: jest.fn().mockResolvedValue({
          id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
          candidateChecksum:
            "b5c1c475672658d5f3760f54b2969428544ca3bcf619c8c998a922485b3b3443",
          decidedByUserId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          decidedAt: new Date("2026-08-01T11:00:00+03:00"),
        }),
      },
      publishingCandidate: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          status: "ACTIVE",
          candidateChecksum:
            "b5c1c475672658d5f3760f54b2969428544ca3bcf619c8c998a922485b3b3443",
          payload: body.candidate,
          sourceStatus: body.candidate_status,
        }),
      },
      publishingTarget: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: body.target.target_id,
          businessId: body.target.business_id,
          provider: "META",
          channel: body.target.channel,
          externalAccountId: body.target.external_account_id,
          displayName: body.target.display_name,
          connectionState: "CONNECTED",
          credentialRef: body.target.credential_ref,
          capabilities: body.target.capabilities,
          lastVerifiedAt: null,
          expiresAt: null,
          version: body.target.version,
        }),
      },
      publishingAttempt: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(null),
        create: jest.fn().mockResolvedValue({
          id: body.attempt_id,
          status: "QUEUED",
        }),
        update: attemptUpdate,
      },
    };
    const txPrisma = {
      $transaction: jest.fn(async (cb: (innerTx: any) => unknown) => cb(tx)),
    } as unknown as PrismaService;
    const envelopeBuilder = {
      buildDispatchBody: jest.fn().mockReturnValue({
        body,
        requestFingerprint: "f".repeat(64),
      }),
    } as unknown as DispatchEnvelopeBuilder;
    const txProcessor = new DispatchProcessor(
      txPrisma,
      n8n as any,
      assetIntegrity as any,
      envelopeBuilder,
    );

    await (txProcessor as any).runRevalidationAndCreateAttempt(
      body.intent_id,
      body.intent_version,
      body.idempotency_key,
    );

    expect(attemptUpdate).toHaveBeenCalledWith({
      where: { id: body.attempt_id },
      data: {
        providerRequestFingerprint: "f".repeat(64),
        workflowVersion: body.workflow_version,
      },
    });
  });
});
