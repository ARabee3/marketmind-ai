import { readFileSync } from "fs";
import { join } from "path";
import { PrismaClient } from "@prisma/client";

/**
 * DB-level verification of the partial unique index added in
 * `20260803130842_add_publishing_automation` (Issue #119 Blocker 4).
 *
 * Prisma's schema DSL cannot express a *filtered* unique index, so the
 * authoritative "at most one ACTIVE intent per candidate" constraint lives as
 * raw SQL in the migration. These tests prove the index behaves correctly
 * against the real PostgreSQL:
 *   1. two concurrent "active" intents for one candidate are both rejected
 *      by the index (the second insert raises SQL state 23505);
 *   2. a CANCELLED intent + a new ACTIVE intent for the same candidate coexist
 *      (the partial WHERE clause frees the slot);
 *   3. transitioning an existing ACTIVE intent to CANCELLED frees the slot
 *      so a new ACTIVE intent can be created afterward;
 *   4. the migration.sql actually contains the expected index DDL (guards
 *      against silent edits that would drop the guarantee).
 *
 * The test runs in an ISOLATED throwaway schema (`_pub_idx_verify_<ts>`) so it
 * never depends on the publishing migration being applied to the shared dev
 * schema and never leaves objects behind. Run with `npm run test:db`. It is
 * excluded from the DB-less default `npm test` suite.
 */
const prisma = new PrismaClient();
const SUITE_SCHEMA = `_pub_idx_verify_${Date.now()}`;
// P1 (#119 review): the one-intent-per-candidate slot is occupied across
// active, terminal, AND ambiguous outcomes — only CANCELLED frees it. This
// prevents a second intent after a succeeded/failed/action-required outcome
// that could duplicate or republish a confirmed candidate.
const ACTIVE_STATUSES = [
  "DRAFT",
  "AWAITING_APPROVAL",
  "SCHEDULED",
  "DISPATCHING",
  "SUCCEEDED",
  "FAILED",
  "ACTION_REQUIRED",
];

// Prisma's $executeRawUnsafe forbids multi-statement strings ("cannot insert
// multiple commands into a prepared statement") and search_path is per pooled
// connection, so we fully schema-qualify every statement instead.

function expectUniqueViolation(e: unknown): void {
  const code = (e as { code?: string })?.code;
  const msg = (e as Error)?.message ?? "";
  // ORM ops surface Prisma P2002; raw $executeRawUnsafe ops surface Prisma P2010
  // wrapping the driver error, whose SQLSTATE 23505 / "already exists" / "unique"
  // only appear in the *message text* (not in Prisma's .code). Match any of them.
  const isUnique =
    code === "P2002" ||
    /23505/.test(msg) ||
    /unique/i.test(msg) ||
    /already exists/i.test(msg);
  if (!isUnique) {
    throw e;
  }
}

async function insertIntentRaw(
  id: string,
  candidateId: string,
  status: string,
): Promise<void> {
  await prisma.$executeRawUnsafe(
    `INSERT INTO ${SUITE_SCHEMA}.publishing_intents (id, candidate_id, status) VALUES ('${id}', '${candidateId}', '${status}')`,
  );
}

/** Asserts that inserting an intent raises a unique-violation, not some other error. */
async function expectInsertRejected(
  id: string,
  candidateId: string,
  status: string,
): Promise<void> {
  let threw = false;
  try {
    await insertIntentRaw(id, candidateId, status);
  } catch (e) {
    threw = true;
    expectUniqueViolation(e);
  }
  expect(threw).toBe(true);
}

describe("publishing_intents partial unique index (Issue #119 blocker 4)", () => {
  beforeAll(async () => {
    // Boot a throwaway schema with a minimal publishing_intents that mirrors
    // the columns the index depends on. We do NOT recreate the full table —
    // only the columns the partial unique index references.
    await prisma.$executeRawUnsafe(`CREATE SCHEMA ${SUITE_SCHEMA}`);
    await prisma.$executeRawUnsafe(
      `CREATE TABLE ${SUITE_SCHEMA}.publishing_intents (id uuid primary key, candidate_id uuid not null, status text not null)`,
    );
    // Apply the EXACT index DDL shape from the migration (with the WHERE clause).
    // Mirrors the migration: only CANCELLED frees the candidate slot.
    await prisma.$executeRawUnsafe(
      `CREATE UNIQUE INDEX publishing_intents_candidate_id_active_uniq
           ON ${SUITE_SCHEMA}.publishing_intents (candidate_id)
           WHERE status IN ('DRAFT', 'AWAITING_APPROVAL', 'SCHEDULED', 'DISPATCHING', 'SUCCEEDED', 'FAILED', 'ACTION_REQUIRED')`,
    );
  });

  afterAll(async () => {
    await prisma.$executeRawUnsafe(
      `DROP SCHEMA IF EXISTS ${SUITE_SCHEMA} CASCADE`,
    );
    await prisma.$disconnect();
  });

  it("rejects a second ACTIVE intent for the same candidate (unique violation)", async () => {
    await insertIntentRaw(
      "11111111-1111-4111-8111-111111111111",
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "SCHEDULED",
    );
    await expectInsertRejected(
      "22222222-2222-4222-8222-222222222222",
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "DRAFT",
    );
  });

  it("allows a CANCELLED intent + a new ACTIVE intent for the same candidate", async () => {
    const cand = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    await insertIntentRaw(
      "33333333-3333-4333-8333-333333333333",
      cand,
      "CANCELLED",
    );
    // A new ACTIVE intent must NOT collide with the cancelled one.
    await insertIntentRaw(
      "44444444-4444-4444-8444-444444444444",
      cand,
      "AWAITING_APPROVAL",
    );
  });

  it("rejects a second intent per EACH active status (every active status occupies the slot)", async () => {
    const cand = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    // Insert one anchor ACTIVE intent in SCHEDULED, then assert every other
    // active status (and a second SCHEDULED) collides with it.
    await insertIntentRaw(
      "5a000000-0000-4000-8000-000000000001",
      cand,
      "SCHEDULED",
    );
    for (const other of ACTIVE_STATUSES) {
      await expectInsertRejected(
        "5a000000-0000-4000-8000-000000000002",
        cand,
        other,
      );
    }
    // Sanity: a distinct candidate is allowed its own active intent.
    await insertIntentRaw(
      "66666666-6666-4666-8666-666666666666",
      "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      "SCHEDULED",
    );
  });

  it("transitions ACTIVE→CANCELLED then admits a new ACTIVE intent (slot freed)", async () => {
    const cand = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    await insertIntentRaw(
      "77777777-7777-4777-8777-777777777777",
      cand,
      "AWAITING_APPROVAL",
    );
    // Cancel the existing active intent.
    await prisma.$executeRawUnsafe(
      `UPDATE ${SUITE_SCHEMA}.publishing_intents SET status = 'CANCELLED' WHERE id = '77777777-7777-4777-8777-777777777777'`,
    );
    // Now a brand new ACTIVE intent for the same candidate must succeed — this
    // is the "cancelled intent can be replaced by a fresh one" product rule.
    await insertIntentRaw(
      "88888888-8888-4888-8888-888888888888",
      cand,
      "SCHEDULED",
    );
  });

  it("the migration.sql contains the expected partial unique index DDL", () => {
    const migration = readFileSync(
      join(
        __dirname,
        "..",
        "prisma",
        "migrations",
        "20260803130842_add_publishing_automation",
        "migration.sql",
      ),
      "utf8",
    );
    expect(migration).toContain("publishing_intents_candidate_id_active_uniq");
    expect(migration).toMatch(/CREATE\s+UNIQUE\s+INDEX/i);
    expect(migration).toMatch(/WHERE\s+"?status"?\s+IN\s*\(/i);
    // P1: the slot covers active + terminal + ambiguous outcomes (only CANCELLED
    // frees it), so the migration WHERE must list these statuses explicitly.
    for (const s of ["SUCCEEDED", "FAILED", "ACTION_REQUIRED"]) {
      expect(migration).toContain(s);
    }
  });
});
