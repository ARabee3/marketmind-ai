import * as crypto from "crypto";
import { EventEmitter } from "events";
import * as fs from "fs";
import * as path from "path";

const workflow = JSON.parse(
  fs.readFileSync(
    path.resolve(process.cwd(), "../../infra/n8n/workflows/publishing-v1.json"),
    "utf8",
  ),
) as {
  nodes: Array<{ name: string; parameters: { jsCode?: string } }>;
};
const fixture = JSON.parse(
  fs.readFileSync(
    path.resolve(
      process.cwd(),
      "../../infra/n8n/fixtures/publishing-dispatch-real.example.json",
    ),
    "utf8",
  ),
);
const adapterCode = workflow.nodes.find(
  (node) => node.name === "Meta Provider Executor (server-side)",
)!.parameters.jsCode!;
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

type PlannedResponse = {
  status?: number;
  body?: Buffer | string;
  error?: Error;
};

async function runAdapter(executorResponse: PlannedResponse) {
  const envelope = structuredClone(fixture);

  const calls: Array<{
    url: string;
    options: { method: string; headers: Record<string, string> };
    payload: Buffer | undefined;
  }> = [];

  const transport = {
    request: jest.fn(
      (
        url: string,
        options: { method: string; headers: Record<string, string> },
        onResponse: (
          response: EventEmitter & { statusCode: number; headers: object },
        ) => void,
      ) => {
        const request = new EventEmitter() as EventEmitter & {
          end: (body?: Buffer) => void;
          setTimeout: (ms: number, callback: () => void) => void;
          destroy: (error: Error) => void;
        };
        request.setTimeout = jest.fn();
        request.destroy = (error) => request.emit("error", error);
        request.end = (payload?: Buffer) => {
          calls.push({ url, options, payload });
          queueMicrotask(() => {
            if (executorResponse.error) {
              request.emit("error", executorResponse.error);
              return;
            }
            const response = new EventEmitter() as EventEmitter & {
              statusCode: number;
              headers: object;
            };
            response.statusCode = executorResponse.status ?? 200;
            response.headers = {};
            onResponse(response);
            if (executorResponse.body !== undefined) {
              response.emit("data", executorResponse.body);
            }
            response.emit("end");
          });
        };
        return request;
      },
    ),
  };
  const localRequire = (name: string) => {
    if (name === "crypto") return crypto;
    if (name === "http" || name === "https") return transport;
    throw new Error(`Unexpected module request: ${name}`);
  };
  const run = new AsyncFunction("$json", "$env", "require", adapterCode);
  const output = await run(
    { envelope },
    {
      PUBLISHING_INTERNAL_SERVICE_TOKEN: "internal-token",
      PUBLISHING_CALLBACK_BASE_URL: "http://127.0.0.1:3001",
    },
    localRequire,
  );

  return { output, calls };
}

const baseResult = {
  contract_version: "publication-result-v1",
  result_id: "11111111-1111-4111-8111-111111111111",
  attempt_id: "attempt-1",
  intent_id: "intent-1",
  intent_version: 1,
  occurred_at: new Date().toISOString(),
  mode: "real",
  provider: "meta",
};

describe("publishing-v1 Meta Provider Executor node (issue #175)", () => {
  it("calls the API-owned executor with ONLY opaque identifiers — no token ever leaves", async () => {
    const { calls } = await runAdapter({
      status: 200,
      body: JSON.stringify({
        result: { ...baseResult, outcome: "published" },
      }),
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain(
      "/internal/v1/publishing/execute-meta",
    );
    expect(calls[0].url).not.toContain("access_token");
    expect(calls[0].options.headers).not.toHaveProperty("Authorization");
    const body = JSON.parse(calls[0].payload!.toString("utf8"));
    expect(body).toEqual({
      attempt_id: fixture.body.attempt_id,
      intent_id: fixture.body.intent_id,
      target_id: fixture.body.target.target_id,
    });
    expect(JSON.stringify(calls[0].payload)).not.toMatch(/token|secret|Bearer/i);
  });

  it("forwards a PUBLISHED executor result with remote identity", async () => {
    const { output } = await runAdapter({
      status: 200,
      body: JSON.stringify({
        result: {
          ...baseResult,
          outcome: "published",
          remote_publication_id: "post-123",
          remote_url: "https://facebook.example/post-123",
          retryable: false,
          reconciliation_required: false,
        },
      }),
    });

    expect(output.json.result).toMatchObject({
      contract_version: "publication-result-v1",
      outcome: "published",
      remote_publication_id: "post-123",
      remote_url: "https://facebook.example/post-123",
      error_code: null,
      retryable: false,
      reconciliation_required: false,
    });
  });

  it("forwards a sanitized FAILED executor result (rate limit mapping stays API-owned)", async () => {
    const { output } = await runAdapter({
      status: 200,
      body: JSON.stringify({
        result: {
          ...baseResult,
          outcome: "failed",
          error_code: "PUBLISHING_PROVIDER_RATE_LIMITED",
          retryable: true,
        },
      }),
    });

    expect(output.json.result).toMatchObject({
      outcome: "failed",
      error_code: "PUBLISHING_PROVIDER_RATE_LIMITED",
      retryable: true,
      reconciliation_required: false,
    });
  });

  it("keeps an unparseable executor response UNKNOWN", async () => {
    const { output } = await runAdapter({ status: 200, body: "not-json" });

    expect(output.json.result).toMatchObject({
      outcome: "unknown",
      error_code: "PUBLISHING_PROVIDER_OUTCOME_UNKNOWN",
      retryable: false,
      reconciliation_required: true,
    });
  });

  it("keeps a non-publication-result response UNKNOWN", async () => {
    const { output } = await runAdapter({
      status: 200,
      body: JSON.stringify({ result: { outcome: "published" } }),
    });

    expect(output.json.result).toMatchObject({
      outcome: "unknown",
      error_code: "PUBLISHING_PROVIDER_OUTCOME_UNKNOWN",
      reconciliation_required: true,
    });
  });

  it("maps a network failure to UNKNOWN (never blind-retry)", async () => {
    const { output } = await runAdapter({
      error: Object.assign(new Error("connection reset"), {
        code: "ECONNRESET",
      }),
    });

    expect(output.json.result).toMatchObject({
      outcome: "unknown",
      error_code: "PUBLISHING_PROVIDER_OUTCOME_UNKNOWN",
      reconciliation_required: true,
    });
  });

  it("fails closed (TARGET_UNAUTHORIZED) when the executor URL/token is unconfigured", async () => {
    const run = new AsyncFunction("$json", "$env", "require", adapterCode);
    const transport = {
      request: jest.fn(() => {
        throw new Error("must not be called when config is missing");
      }),
    };
    const output = await run(
      { envelope: structuredClone(fixture) },
      { PUBLISHING_INTERNAL_SERVICE_TOKEN: "" },
      (name: string) => {
        if (name === "crypto") return crypto;
        if (name === "http" || name === "https") return transport;
        throw new Error(`Unexpected module request: ${name}`);
      },
    );
    expect(output.json.result).toMatchObject({
      outcome: "failed",
      error_code: "PUBLISHING_TARGET_UNAUTHORIZED",
      retryable: false,
    });
    expect(transport.request).not.toHaveBeenCalled();
  });
});
