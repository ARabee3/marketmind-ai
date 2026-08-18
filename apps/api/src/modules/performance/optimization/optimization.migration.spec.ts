import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const MIGRATION_PATH = resolve(
  __dirname,
  "../../../../prisma/migrations/20260818150000_add_optimization_proposals/migration.sql",
);

describe("OptimizationProposal migration", () => {
  it("keeps the proposal boundary immutable and provider-payload free", () => {
    const migration = readFileSync(MIGRATION_PATH, "utf8");

    expect(migration).toContain('CREATE TABLE "optimization_proposals"');
    expect(migration).toContain(
      "optimization_proposals_business_id_generation_fingerprint_key",
    );
    expect(migration).toContain(
      'CONSTRAINT "optimization_proposals_status_check" CHECK ("status" = \'PENDING_OWNER_DECISION\')',
    );
    expect(migration).toContain(
      'jsonb_array_length("basis_snapshot_ids") >= 3',
    );
    expect(migration).toContain(
      'jsonb_array_length("deterministic_comparison") = 2',
    );
    expect(migration).toContain(
      "optimization_proposals_evidence_checksum_check",
    );
    expect(migration).toContain(
      "optimization_proposals_generation_fingerprint_check",
    );
    expect(migration).toContain("optimization_proposals_immutable");
    expect(migration).not.toMatch(/access[_ ]token|raw[_ ]payload|caption/i);
  });
});
