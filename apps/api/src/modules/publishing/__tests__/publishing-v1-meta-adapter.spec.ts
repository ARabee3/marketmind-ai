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
  (node) => node.name === "Real Meta Adapter (static image)",
)!.parameters.jsCode!;
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

type PlannedResponse = {
  status?: number;
  body?: Buffer | string;
  error?: Error;
};

async function runAdapter(metaResponse: PlannedResponse, includeLink = false) {
  const media = Buffer.from("approved-image-bytes", "utf8");
  const checksum = crypto.createHash("sha256").update(media).digest("hex");
  const envelope = structuredClone(fixture);
  envelope.body.assets[0].checksum = checksum;
  envelope.body.assets[0].retrieval_expires_at = "2099-08-03T15:35:00Z";
  envelope.body.candidate.assets[0].checksum = checksum;

  const planned: PlannedResponse[] = [
    { status: 200, body: media },
    metaResponse,
  ];
  if (includeLink) {
    planned.push({
      status: 200,
      body: JSON.stringify({ link: "https://facebook.example/post-123" }),
    });
  }
  const calls: Array<{
    url: string;
    options: { method: string; headers: Record<string, string> };
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
        calls.push({ url, options });
        const request = new EventEmitter() as EventEmitter & {
          end: (body?: Buffer) => void;
          setTimeout: (ms: number, callback: () => void) => void;
          destroy: (error: Error) => void;
        };
        request.setTimeout = jest.fn();
        request.destroy = (error) => request.emit("error", error);
        request.end = () => {
          const next = planned.shift();
          if (!next) throw new Error(`No fake response planned for ${url}`);
          queueMicrotask(() => {
            if (next.error) {
              request.emit("error", next.error);
              return;
            }
            const response = new EventEmitter() as EventEmitter & {
              statusCode: number;
              headers: object;
            };
            response.statusCode = next.status ?? 200;
            response.headers = {};
            onResponse(response);
            if (next.body !== undefined) response.emit("data", next.body);
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
      META_TEST_PAGE_ACCESS_TOKEN: "meta-token",
      META_TEST_PAGE_ID: envelope.body.target.external_account_id,
    },
    localRequire,
  );

  return { output, calls };
}

describe("publishing-v1 real Meta adapter", () => {
  it("keeps a successful but empty provider response UNKNOWN", async () => {
    const { output } = await runAdapter({ status: 200, body: "{}" });

    expect(output.json.result).toMatchObject({
      outcome: "unknown",
      error_code: "PUBLISHING_PROVIDER_OUTCOME_UNKNOWN",
      retryable: false,
      reconciliation_required: true,
      remote_publication_id: null,
    });
  });

  it("keeps an unparseable post-send response UNKNOWN", async () => {
    const { output } = await runAdapter({
      status: 200,
      body: "not-json",
    });

    expect(output.json.result).toMatchObject({
      outcome: "unknown",
      error_code: "PUBLISHING_PROVIDER_OUTCOME_UNKNOWN",
      retryable: false,
      reconciliation_required: true,
    });
  });

  it("claims PUBLISHED only with a provider-returned id", async () => {
    const { output, calls } = await runAdapter(
      {
        status: 200,
        body: JSON.stringify({ id: "photo-123", post_id: "post-123" }),
      },
      true,
    );

    expect(output.json.result).toMatchObject({
      outcome: "published",
      remote_publication_id: "post-123",
      remote_url: "https://facebook.example/post-123",
      reconciliation_required: false,
    });
    expect(calls[1].url).not.toContain("access_token");
    expect(calls[1].options.headers.Authorization).toBe("Bearer meta-token");
  });
});
