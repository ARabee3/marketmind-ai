/**
 * Dispatch delivery classification — REAL client-to-processor path (P1 #119).
 *
 * P1 (#119 review): `N8nClientService.dispatch` routes every Axios failure
 * through `safeHttp`, which rethrows a typed `SafeHttpError` carrying only an
 * `ambiguousDelivery` flag — the raw `code`/`isAxiosError`/`response.status`
 * fields are stripped at the catch site. These tests run the REAL
 * `N8nClientService` (mocked `HttpService` only) through `DispatchProcessor` so
 * they exercise the true safeHttp → SafeHttpError → isAmbiguousDelivery path
 * that the mocked-`n8n.dispatch` race tests cannot reach.
 *
 * Cases:
 *   - Axios timeout (ECONNABORTED) → ambiguous → attempt UNKNOWN, intent
 *     ACTION_REQUIRED, UNKNOWN result (never a blind FAILED retry).
 *   - 5xx from the runner → ambiguous → UNKNOWN/ACTION_REQUIRED.
 *   - 4xx deterministic rejection → not ambiguous → FAILED/FAILED.
 */

import { DispatchProcessor } from "../dispatch.processor";
import { N8nClientService } from "../n8n-client.service";
import { AssetIntegrityValidator } from "../asset-integrity-validator";
import { DispatchEnvelopeBuilder } from "../dispatch-envelope.builder";
import { PrismaService } from "../../../../common/persistence/prisma.service";
import { ConfigService } from "@nestjs/config";
import { HttpService } from "@nestjs/axios";
import { throwError } from "rxjs";
import type { PublicationDispatchBodyV1 } from "@marketmind/contracts";

const N8N_URL = "http://localhost:5678/webhook/publish";
const SECRET = "signing-secret-32chars-long!!!!!";
const N8N_TOKEN = "n8n-bearer-token";

function axiosError(
  message: string,
  opts: { code?: string; status?: number } = {},
): Error {
  const err = new Error(message) as Error & {
    code?: string;
    isAxiosError?: boolean;
    response?: { status?: number };
    config?: Record<string, unknown>;
  };
  err.isAxiosError = true;
  err.code = opts.code;
  err.response =
    typeof opts.status === "number" ? { status: opts.status } : undefined;
  err.config = { method: "post", url: N8N_URL };
  return err;
}

function n8nConfig(): ConfigService {
  return {
    get: (k: string) =>
      k === "publishing.n8nWebhookUrl"
        ? N8N_URL
        : k === "publishing.n8nSigningSecret"
          ? SECRET
          : k === "publishing.n8nSigningKeyId"
            ? "kid-1"
            : k === "publishing.n8nAuthToken"
              ? N8N_TOKEN
              : "",
  } as unknown as ConfigService;
}

function buildRealBody(): PublicationDispatchBodyV1 {
  // The body content is not validated on this path (asset integrity & the
  // revalidation tx are mocked); we only need a real-mode body so the processor
  // routes through the ambiguous-delivery branch.
  return {
    contract_version: "publication-dispatch-v1",
    attempt_id: "11111100-0000-4000-8000-0000000000a1",
    intent_id: "11111100-0000-4000-8000-0000000000i1",
    intent_version: 1,
    business_id: "aaaaaaaa-aaaa-4000-8000-aaaaaaaaaaaa",
    correlation_id: "11111100-0000-4000-8000-0000000000i1",
    idempotency_key: "key-1::dispatch",
    workflow_version: "v1",
    candidate: {} as never,
    candidate_status: {} as never,
    assets: [],
    callback_url:
      "http://localhost:3001/internal/v1/publishing/dispatch/11111100-0000-4000-8000-0000000000a1/callback",
    mode: "real",
    operation: "meta.publish_static_image",
    target: {} as never,
    approval: {} as never,
    scheduled_utc: new Date().toISOString(),
  } as unknown as PublicationDispatchBodyV1;
}

function buildProcessor({ httpPost }: { httpPost: jest.Mock }) {
  const http = { post: httpPost } as unknown as HttpService;
  const n8n = new N8nClientService(http, n8nConfig());
  const assetIntegrity = {
    validateForDispatch: jest.fn().mockResolvedValue(undefined),
  } as unknown as AssetIntegrityValidator;

  const attemptUpdate = jest.fn().mockResolvedValue({});
  const resultFindUnique = jest.fn().mockResolvedValue(null);
  const resultCreate = jest.fn().mockResolvedValue({});
  const intentUpdateMany = jest.fn().mockResolvedValue({ count: 1 });

  const prisma = {
    $transaction: jest
      .fn()
      // revalidation tx
      .mockResolvedValueOnce({
        replayed: false,
        attemptId: "attempt-1",
        status: "QUEUED",
        body: buildRealBody(),
      })
      // post-failure write tx
      .mockImplementationOnce(async (cb: (tx: any) => any) =>
        cb({
          publishingAttempt: { update: attemptUpdate },
          publishingResult: {
            findUnique: resultFindUnique,
            create: resultCreate,
          },
          publishingIntent: { updateMany: intentUpdateMany },
        }),
      ),
    publishingAttempt: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }), // atomic claim wins
      update: jest.fn().mockResolvedValue({}),
    } as any,
    publishingIntent: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    } as any,
  } as unknown as PrismaService;

  const processor = new DispatchProcessor(
    prisma,
    n8n,
    assetIntegrity,
    new DispatchEnvelopeBuilder({ get: () => "" } as any),
  );
  jest.spyOn(processor["logger"], "log").mockImplementation(() => {});
  jest.spyOn(processor["logger"], "warn").mockImplementation(() => {});
  jest.spyOn(processor["logger"], "error").mockImplementation(() => {});

  return {
    processor,
    attemptUpdate,
    resultCreate,
    intentUpdateMany,
  };
}

const job = {
  data: {
    intentId: "i-1",
    version: 1,
    idempotencyKey: "k-1",
  },
} as never;

describe("DispatchProcessor — real safeHttp → ambiguous delivery (P1 #119)", () => {
  it("an Axios timeout (ECONNABORTED) classifies AMBIGUOUS → UNKNOWN attempt + ACTION_REQUIRED intent + UNKNOWN result", async () => {
    const { processor, attemptUpdate, resultCreate, intentUpdateMany } =
      buildProcessor({
        httpPost: jest.fn(() =>
          throwError(() =>
            axiosError("timeout of 15000ms exceeded", { code: "ECONNABORTED" }),
          ),
        ) as never,
      });

    await processor.process(job);

    expect(attemptUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "UNKNOWN" }),
      }),
    );
    expect(intentUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
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

  it("a 5xx from the runner classifies AMBIGUOUS (UNKNOWN/ACTION_REQUIRED), never a blind FAILED retry", async () => {
    const { processor, attemptUpdate, intentUpdateMany, resultCreate } =
      buildProcessor({
        httpPost: jest.fn(() =>
          throwError(() => axiosError("Bad Gateway", { status: 502 })),
        ) as never,
      });

    await processor.process(job);

    expect(attemptUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "UNKNOWN" }),
      }),
    );
    expect(intentUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "ACTION_REQUIRED" } }),
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

  it("a 4xx deterministic rejection classifies NOT ambiguous → FAILED attempt + FAILED intent", async () => {
    const { processor, attemptUpdate, intentUpdateMany, resultCreate } =
      buildProcessor({
        httpPost: jest.fn(() =>
          throwError(() => axiosError("Bad Request", { status: 400 })),
        ) as never,
      });

    await processor.process(job);

    expect(attemptUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "FAILED" }),
      }),
    );
    expect(intentUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "FAILED" } }),
    );
    expect(resultCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ outcome: "FAILED", retryable: false }),
      }),
    );
  });
});
