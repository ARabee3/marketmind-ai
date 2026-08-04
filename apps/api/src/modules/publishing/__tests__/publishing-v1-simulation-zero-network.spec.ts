import * as fs from "fs";
import * as path from "path";

/**
 * Phase 7 (#120) — proves the simulation branch is zero-network BY
 * CONSTRUCTION and emits a correctly-labelled SIMULATION result, rather than
 * merely asserting it. The n8n workflow JSON is the source of truth for what
 * the runner executes, so we inspect the Simulation Adapter Code node and
 * assert it never imports a network primitive (http/https/fetch/request) and
 * that the result it builds carries no remote identity and is labelled
 * SIMULATION end-to-end.
 *
 * A dynamic "network spy" run inside Jest is not feasible because n8n is an
 * external runner; this static guarantee is the equivalent automated check and
 * fails the build if a future edit silently wires the simulation branch to the
 * network.
 */
describe("publishing-v1 simulation branch is zero-network (#120 Phase 7)", () => {
  const workflowPath = path.resolve(
    process.cwd(),
    "../../infra/n8n/workflows/publishing-v1.json",
  );
  const wf = JSON.parse(fs.readFileSync(workflowPath, "utf8")) as {
    nodes: Array<{ name: string; type: string; parameters: { jsCode?: string } }>;
  };
  const sim = wf.nodes.find((n) => n.name === "Simulation Adapter (zero-network)");
  const real = wf.nodes.find((n) => n.name === "Real Meta Adapter (static image)");

  it("the workflow exports a Simulation Adapter node", () => {
    expect(sim).toBeDefined();
    expect(sim!.parameters.jsCode).toBeTruthy();
  });

  it("the simulation adapter never imports or calls a network primitive", () => {
    const code = sim!.parameters.jsCode ?? "";
    expect(code).not.toMatch(/require\s*\(\s*["']https?["']\s*\)/);
    expect(code).not.toMatch(/require\s*\(\s*["']http["']\s*\)/);
    expect(code).not.toMatch(/require\s*\(\s*["']request["']\s*\)/);
    expect(code).not.toMatch(/\bfetch\s*\(/);
    expect(code).not.toMatch(/\$httpRequest|this\.helpers\.httpRequest/);
  });

  it("the simulation adapter builds a SIMULATED result with no remote identity", () => {
    const code = sim!.parameters.jsCode ?? "";
    expect(code).toMatch(/outcome:\s*["']simulated["']/);
    expect(code).toMatch(/simulation_label:\s*["']SIMULATION["']/);
    expect(code).toMatch(/simulation_reference_id:\s*["']sim-["']/);
    expect(code).toMatch(/remote_publication_id:\s*null/);
    expect(code).toMatch(/remote_url:\s*null/);
    expect(code).toMatch(/provider:\s*null/);
  });

  it("the real adapter (contrast) DOES use the network — guard against a stale swap", () => {
    const code = real!.parameters.jsCode ?? "";
    expect(code).toMatch(/require\s*\(\s*["']https["']\s*\)/);
    expect(code).toMatch(/graph\.facebook\.com/);
  });
});