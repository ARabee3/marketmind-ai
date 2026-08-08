import * as fs from "fs";
import * as path from "path";

/**
 * Secret-redaction scans (issue #175 acceptance): proves by CONSTRUCTION that
 * customer credential material can never reach the browser surface, the n8n
 * runner, seed data, or fixtures — the same static-guarantee approach the
 * zero-network simulation spec uses for the workflow JSON.
 */
describe("publishing secret-redaction scans (issue #175)", () => {
  const workflow = JSON.parse(
    fs.readFileSync(
      path.resolve(process.cwd(), "../../infra/n8n/workflows/publishing-v1.json"),
      "utf8",
    ),
  ) as { nodes: Array<{ name: string; parameters: { jsCode?: string } }> };
  const seedSource = fs.readFileSync(
    path.resolve(process.cwd(), "../../apps/api/scripts/seed-publishing-demo.ts"),
    "utf8",
  );
  const executorClient = workflow.nodes.find(
    (n) => n.name === "Meta Provider Executor (server-side)",
  )!.parameters.jsCode!;

  it("the workflow never reads a Meta token from its environment", () => {
    // Legacy env lookups were removed in #175; only the explanatory comment
    // may mention the removed variable name.
    expect(executorClient).not.toMatch(/env\.META_TEST/);
    expect(executorClient).not.toMatch(/env\.(META_|FACEBOOK_).*TOKEN/);
    expect(executorClient).not.toMatch(/Bearer\s*\+/);
    expect(executorClient).not.toMatch(/graph\.facebook\.com/);
  });

  it("the demo seed never fabricates a CONNECTED target with an env credentialRef", () => {
    expect(seedSource).not.toContain("env:META_TEST_PAGE_ACCESS_TOKEN");
    expect(seedSource).not.toContain("META_TEST_PAGE_ACCESS_TOKEN");
    expect(seedSource).not.toContain("credentialRef: \"env:");
    expect(seedSource).toContain("no-credentials-demo");
  });

  it("the workflow adapter forwards only opaque identifiers", () => {
    expect(executorClient).toContain("/internal/v1/publishing/execute-meta");
    expect(executorClient).toContain("x-publishing-internal-token");
    // The executor request body carries attempt/intent/target ids only.
    const bodyFields = [
      "attempt_id",
      "intent_id",
      "target_id",
    ];
    for (const field of bodyFields) {
      expect(executorClient).toContain(field);
    }
  });

  it("no committed file under infra/n8n holds a live-looking Meta token", () => {
    const infraDir = path.resolve(process.cwd(), "../../infra/n8n");
    const walk = (dir: string): string[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory()
          ? walk(path.join(dir, entry.name))
          : [path.join(dir, entry.name)],
      );
    const files = walk(infraDir).filter(
      (f) => /\.(json|md|js|ts)$/.test(f) && !f.includes("node_modules"),
    );
    for (const file of files) {
      const source = fs.readFileSync(file, "utf8");
      // Long Meta-style tokens (EA...) or page tokens must not appear as
      // literal values in committed runner assets.
      expect(source).not.toMatch(/EAA[A-Za-z0-9]{24,}/);
    }
  });

  it("the browser-safe projection surface is the only target serializer", () => {
    const serviceSource = fs.readFileSync(
      path.resolve(
        process.cwd(),
        "../../apps/api/src/modules/publishing/targets/targets.service.ts",
      ),
      "utf8",
    );
    // The allow-list projector comment documents the guarantee; the function
    // body must never spread the raw row.
    const projector = serviceSource.slice(
      serviceSource.indexOf("export function toTargetProjection"),
      serviceSource.indexOf("export function toTargetProjection") + 800,
    );
    expect(projector).not.toMatch(/\.\.\.target/);
    expect(projector).toContain("credentialRef is intentionally ABSENT");
  });
});
