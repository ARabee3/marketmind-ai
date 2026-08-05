import * as fs from "fs";
import * as path from "path";

type WorkflowNode = {
  name: string;
  parameters: {
    jsCode?: string;
    responseBody?: string;
    options?: Record<string, unknown>;
  };
};

const workflowPath = path.resolve(
  process.cwd(),
  "../../infra/n8n/workflows/publishing-v1.json",
);
const fixturePath = path.resolve(
  process.cwd(),
  "../../infra/n8n/fixtures/publishing-dispatch-real.example.json",
);
const workflow = JSON.parse(fs.readFileSync(workflowPath, "utf8")) as {
  nodes: WorkflowNode[];
  connections: Record<string, unknown>;
};
const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));

function node(name: string): WorkflowNode {
  const found = workflow.nodes.find((item) => item.name === name);
  if (!found) throw new Error(`Workflow node not found: ${name}`);
  return found;
}

function validate(envelope: unknown) {
  const run = new Function(
    "$json",
    "require",
    node("Validate Envelope Shape").parameters.jsCode!,
  );
  return run({ envelope }, require) as {
    json: { valid: boolean; error?: string };
  };
}

describe("publishing-v1 workflow trust boundaries", () => {
  it("accepts the complete frozen real-dispatch fixture", () => {
    expect(validate(structuredClone(fixture)).json.valid).toBe(true);
  });

  it("rejects a real dispatch that swaps operation and removes approval bindings", () => {
    const changed = structuredClone(fixture);
    changed.body.operation = "simulation.run";
    changed.body.target = null;
    changed.body.approval = null;
    changed.body.assets = [];

    const result = validate(changed).json;

    expect(result.valid).toBe(false);
    expect(result.error).toMatch(
      /operation mismatch|target missing|approval missing/,
    );
  });

  it("rejects revoked or identity-mismatched candidate state", () => {
    const changed = structuredClone(fixture);
    changed.body.candidate_status.candidate_state = "revoked";
    changed.body.candidate_status.candidate_checksum = "f".repeat(64);

    const result = validate(changed).json;

    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/candidate is not active/);
    expect(result.error).toMatch(/candidate status checksum mismatch/);
  });

  it("rejects dispatch media that differs from the approved candidate", () => {
    const changed = structuredClone(fixture);
    changed.body.assets[0].checksum = "f".repeat(64);

    const result = validate(changed).json;

    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/dispatch asset checksum or MIME mismatch/);
  });

  it("returns real HTTP error codes and acknowledges before provider routing", () => {
    for (const name of [
      "Respond 401 - Auth",
      "Respond 400 - Shape",
      "Respond 401 - Signature",
    ]) {
      expect(node(name).parameters.options?.responseCode).toBe(
        "={{$json.statusCode}}",
      );
    }

    const accepted = node("Respond 202 - Accepted");
    expect(accepted.parameters.options?.responseCode).toBe(202);
    expect(accepted.parameters.responseBody).toContain('"accepted": true');
    expect(workflow.connections["IF Signature OK"]).toEqual({
      main: [
        [
          {
            node: "Respond 202 - Accepted",
            type: "main",
            index: 0,
          },
        ],
        [
          {
            node: "Respond 401 - Signature",
            type: "main",
            index: 0,
          },
        ],
      ],
    });
    expect(workflow.connections["Respond 202 - Accepted"]).toEqual({
      main: [[{ node: "Route By Mode", type: "main", index: 0 }]],
    });
    expect(workflow.connections["POST Callback to NestJS"]).toBeUndefined();
  });

  it("fails authentication closed when the n8n bearer token is unset", () => {
    const run = new Function(
      "$json",
      "$env",
      node("Check Auth").parameters.jsCode!,
    );

    expect(
      run({ headers: { authorization: "Bearer undefined" }, body: fixture }, {})
        .json.valid,
    ).toBe(false);
  });
});
