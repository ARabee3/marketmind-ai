import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const MIGRATION_PATH = resolve(
  __dirname,
  "../../../../prisma/migrations/20260818170000_add_optimization_decisions/migration.sql",
);

describe("Optimization 2 decision migration", () => {
  it("defines immutable terminal decisions and a forward-only consumption boundary", () => {
    const migration = readFileSync(MIGRATION_PATH, "utf8");

    expect(migration).toContain('CREATE TABLE "optimization_decisions"');
    expect(migration).toContain(
      'CREATE TABLE "approved_optimization_instructions"',
    );
    expect(migration).toContain("optimization_decisions_immutable");
    expect(migration).toContain(
      "approved_optimization_instructions_forward_only",
    );
    expect(migration).toContain("PENDING_CONSUMPTION");
    expect(migration).toContain("CONSUMED");
    expect(migration).toContain("optimization_decisions_proposal_id_key");
    expect(migration).toContain(
      "approved_optimization_instructions_consumed_content_pack_id_key",
    );
    expect(migration).toContain(
      "approved_optimization_instructions_consumed_week_plan_id_key",
    );
    expect(migration).toContain("one forward transition");
    expect(migration).not.toMatch(/access[_ ]token|raw[_ ]payload/i);
  });
});
