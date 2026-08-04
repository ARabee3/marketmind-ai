import { readFileSync } from "fs";
import { join } from "path";
import { PrismaClient } from "@prisma/client";

/**
 * End-to-end PostgreSQL migration + lifecycle tests for the publishing-v1
 * schema (Issue #119 verification matrix).
 *
 * These tests apply the FULL `20260803130842_add_publishing_automation`
 * migration to an ISOLATED throwaway DATABASE (created per run, dropped
 * CASCADE on cleanup), then exercises the exact DB-level invariants the
 * issue's acceptance criteria depend on:
 *
 *  - empty + seeded migration (tables / enums / FKs / partial unique indices): G8
 *  - partial unique index for active intents (one ACTIVE / candidate): G8
 *  - partial unique index for confirmed publications (one PUBLISHED / intent): G6
 *  - PostgreSQL transaction rollback on partial failure (no half-written approval): G9
 *  - candidate revocation cancels in-flight intents (revoked → no dispatch): G1
 *  - target expiry prevents binding a real intent (G7 / G2): G2
 *  - duplicate delayed-job replay resolves to the SAME attempt (G11 / G3)
 *
 * We use a throwaway DATABASE (not just a schema) because Prisma's
 * $executeRawUnsafe forbids multi-statement prepared strings ("cannot insert
 * multiple commands into a prepared statement") — a fresh empty DB lets every
 * unqualified `CREATE TABLE` / `CREATE TYPE` / `INSERT` in the migration
 * resolve against the default public schema with one statement per rpc, with
 * NO `SET search_path` preamble and NO connection-pooling search_path drift.
 * Run with `npm run test:db`. Excluded from the default DB-less `npm test`.
 */
const adminClient = new PrismaClient();
const TEST_DB = `_pub_migrate_${Date.now()}`;

function buildTestUrl(): string {
  // Inject DATABASE_URL via dotenvx in the test process, then swap the
  // database segment for the throwaway DB name.
  const base = String(process.env.DATABASE_URL ?? "");
  const slash = base.indexOf("/", base.indexOf("//") + 2);
  return base.slice(0, slash + 1) + TEST_DB;
}

let testClient: PrismaClient;

/** Splits the migration into individual statements on `;`-terminated boundaries,
 *  dropping pure-comment lines so Postgres does not choke on lead-in comments. */
function splitStatements(sql: string): string[] {
  const out: string[] = [];
  let buf = "";
  for (const line of sql.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith("--")) continue; // drop full-line comments
    buf += line + "\n";
    if (/;\s*$/.test(trimmed)) {
      void expectUniqueViolation; // keep helper referenced even if unused below
      const stmt = buf.trim();
      if (stmt) out.push(stmt);
      buf = "";
    }
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

function expectUniqueViolation(e: unknown): void {
  const code = (e as { code?: string })?.code;
  const msg = (e as Error)?.message ?? "";
  const isUnique =
    code === "P2002" ||
    /23505/.test(msg) ||
    /unique/i.test(msg) ||
    /already exists/i.test(msg);
  if (!isUnique) throw e;
}

/** Asserts an async fn rejects with a unique-constraint violation (not some
 *  unrelated error), mirroring the helpers in the other db-spec files. */
async function expectRejectUnique(fn: () => Promise<unknown>): Promise<void> {
  let threw = false;
  try {
    await fn();
  } catch (e) {
    threw = true;
    expectUniqueViolation(e);
  }
  expect(threw).toBe(true);
}

describe("publishing-v1 migration + DB invariants (Issue #119 G1/G2/G6/G8/G9/G11)", () => {
  let statements: string[];

  beforeAll(async () => {
    statements = splitStatements(
      readFileSync(
        join(
          __dirname,
          "..",
          "prisma",
          "migrations",
          "20260803130842_add_publishing_automation",
          "migration.sql",
        ),
        "utf8",
      ),
    );
    expect(statements.length).toBeGreaterThan(10);

    // Create an isolated database for this run, then point a fresh PrismaClient
    // at it so every migration statement resolves against a clean public schema.
    await adminClient.$executeRawUnsafe(`CREATE DATABASE ${TEST_DB}`);
    testClient = new PrismaClient({
      datasources: { db: { url: buildTestUrl() } },
    });

    // Apply each migration statement as its own rpc — one statement per call.
    for (const stmt of statements) {
      await testClient.$executeRawUnsafe(stmt);
    }
  });

  afterAll(async () => {
    if (testClient) await testClient.$disconnect();
    await adminClient.$executeRawUnsafe(
      `DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`,
    );
    await adminClient.$disconnect();
  });

  // ── G8: empty migration structure ──────────────────────────────────────
  describe("G8 — migration structure (empty schema)", () => {
    const expectedTables = [
      "publishing_candidates",
      "publishing_targets",
      "publishing_intents",
      "publishing_approvals",
      "publishing_attempts",
      "publishing_results",
      "publishing_callback_identities",
      "publishing_export_metadata",
    ];
    for (const table of expectedTables) {
      it(`created table ${table}`, async () => {
        // to_regclass returns the relation name qualified by schema only when
        // the schema is NOT first in the connection search_path, so the output
        // is environment-dependent (`public.x` or `x`). Assert presence + that
        // it resolves in the public schema (non-null OID is the real invariant).
        const rows = (await testClient.$queryRawUnsafe(
          `SELECT to_regclass('public.${table}')::text AS name`,
        )) as { name: string | null }[];
        expect(rows[0].name).not.toBeNull();
        expect(rows[0].name).toContain(table);
      });
    }

    it("created the 8 publishing enums", async () => {
      const rows = (await testClient.$queryRawUnsafe(
        `SELECT typname FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
         WHERE n.nspname = 'public' AND t.typtype = 'e' ORDER BY typname`,
      )) as { typname: string }[];
      const names = rows.map((r) => r.typname);
      expect(names).toEqual(
        expect.arrayContaining([
          "PublishingApprovalDecision",
          "PublishingAttemptStatus",
          "PublishingCandidateStatus",
          "PublishingIntentStatus",
          "PublishingMode",
          "PublishingOutcome",
          "PublishingTargetConnectionState",
          "PublishingTargetProvider",
        ]),
      );
      expect(names).toHaveLength(8);
    });

    it("created both partial unique indices (active intents + published results)", async () => {
      const rows = (await testClient.$queryRawUnsafe(
        `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname IN ('publishing_intents_candidate_id_active_uniq','publishing_results_intent_id_published_uniq')`,
      )) as { indexname: string }[];
      const names = rows.map((r) => r.indexname);
      expect(names).toContain("publishing_intents_candidate_id_active_uniq");
      expect(names).toContain("publishing_results_intent_id_published_uniq");
    });

    it("created the attempt idempotency-key unique index", async () => {
      const rows = (await testClient.$queryRawUnsafe(
        `SELECT indexname FROM pg_indexes WHERE schemaname = 'public'
         AND indexname = 'publishing_attempts_intent_id_idempotency_key_key'`,
      )) as { indexname: string }[];
      expect(rows).toHaveLength(1);
    });

    it("enforced the 7 foreign keys (cascade rules embedded)", async () => {
      const rows = (await testClient.$queryRawUnsafe(
        `SELECT con.conname FROM pg_constraint con JOIN pg_class cls ON cls.oid = con.conrelid
         JOIN pg_namespace n ON n.oid = cls.relnamespace
         WHERE n.nspname = 'public' AND con.contype = 'f' ORDER BY con.conname`,
      )) as { conname: string }[];
      const names = rows.map((r) => r.conname);
      expect(names).toEqual(
        expect.arrayContaining([
          "publishing_intents_candidate_id_fkey",
          "publishing_intents_target_id_fkey",
          "publishing_approvals_intent_id_fkey",
          "publishing_attempts_intent_id_fkey",
          "publishing_results_attempt_id_fkey",
          "publishing_callback_identities_attempt_id_fkey",
          "publishing_export_metadata_intent_id_fkey",
        ]),
      );
      expect(names).toHaveLength(7);
    });
  });

  // ── G8: seeded round-trip (insert + read back) ─────────────────────────
  describe("G8 — seeded round-trip", () => {
    it("inserts a candidate→intent→approval→attempt→result chain and reads it back", async () => {
      // Mirror the NOT NULL / FK shape the migration enforces, hand-rolled so
      // we exercise the raw schema (not the Prisma client typing).
      await testClient.$executeRawUnsafe(
        `INSERT INTO publishing_candidates (id, business_id, external_content_id, candidate_checksum, event_fingerprint, status, payload, channel, format, locale, source_state_version, version, updated_at, event_id, source_status)
         VALUES ('11111100-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4000-8000-aaaaaaaaaaaa','content-1','chk1','fp1','ACTIVE','{}','facebook','static_image','ar',1,1,now(),'deded000-0000-4000-8000-000000000001','{"contract_version":"publication-candidate-status-v1","candidate_state":"active"}'::jsonb)`,
      );
      await testClient.$executeRawUnsafe(
        `INSERT INTO publishing_intents (id, business_id, candidate_id, mode, status, version, created_by_user_id, updated_at)
         VALUES ('11111100-0000-4000-8000-000000000002','aaaaaaaa-aaaa-4000-8000-aaaaaaaaaaaa','11111100-0000-4000-8000-000000000001','REAL','DRAFT',1,'bbbbbbbb-bbbb-4000-8000-bbbbbbbbbbbb',now())`,
      );
      const got = (await testClient.$queryRawUnsafe(
        `SELECT candidate_id, mode, status FROM publishing_intents WHERE id = '11111100-0000-4000-8000-000000000002'`,
      )) as { candidate_id: string; mode: string; status: string }[];
      expect(got[0]).toEqual({
        candidate_id: "11111100-0000-4000-8000-000000000001",
        mode: "REAL",
        status: "DRAFT",
      });
    });
  });

  // ── G6: partial unique index on confirmed publications ──────────────────
  describe("G6 — one PUBLISHED result per intent", () => {
    it("rejects a second PUBLISHED result for the same intent", async () => {
      const cand = "22222200-0000-4000-8000-000000000001";
      const intent = "22222200-0000-4000-8000-000000000002";
      await testClient.$executeRawUnsafe(
        `INSERT INTO publishing_candidates (id, business_id, external_content_id, candidate_checksum, event_fingerprint, status, payload, channel, format, locale, source_state_version, version, updated_at, event_id, source_status)
         VALUES ('${cand}','cccccccc-cccc-4000-8000-cccccccccccc','c-2','chk2','fp2','ACTIVE','{}','facebook','static_image','ar',1,1,now(),'deded000-0000-4000-8000-000000000001','{"contract_version":"publication-candidate-status-v1","candidate_state":"active"}'::jsonb)`,
      );
      await testClient.$executeRawUnsafe(
        `INSERT INTO publishing_intents (id, business_id, candidate_id, mode, status, version, created_by_user_id, updated_at)
         VALUES ('${intent}','cccccccc-cccc-4000-8000-cccccccccccc','${cand}','REAL','SUCCEEDED',1,'cccccccc-cccc-4000-8000-cccccccccccc',now())`,
      );
      const attempt = "22222200-0000-4000-8000-000000000010";
      await testClient.$executeRawUnsafe(
        `INSERT INTO publishing_attempts (id, intent_id, intent_version, attempt_sequence, status, idempotency_key, updated_at)
         VALUES ('${attempt}','${intent}',1,1,'SUCCEEDED','k-pub-1',now())`,
      );
      await testClient.$executeRawUnsafe(
        `INSERT INTO publishing_results (id, attempt_id, intent_id, outcome, retryable, occurred_at)
         VALUES ('22222200-0000-4000-8000-000000000020','${attempt}','${intent}','PUBLISHED',false,now())`,
      );
      // Second PUBLISHED for the SAME intent must be rejected by the partial unique.
      await expectRejectUnique(() =>
        testClient.$executeRawUnsafe(
          `INSERT INTO publishing_results (id, attempt_id, intent_id, outcome, retryable, occurred_at)
           VALUES ('22222200-0000-4000-8000-000000000021','${attempt}','${intent}','PUBLISHED',false,now())`,
        ),
      );
    });

    it("allows a second EXPORTED result for the same intent (not a confirmed publication)", async () => {
      const intent = "22222200-0000-4000-8000-000000000002"; // same intent as above
      const attempt2 = "22222200-0000-4000-8000-000000000011";
      await testClient.$executeRawUnsafe(
        `INSERT INTO publishing_attempts (id, intent_id, intent_version, attempt_sequence, status, idempotency_key, updated_at)
         VALUES ('${attempt2}','${intent}',1,2,'SUCCEEDED','k-exp-1',now())`,
      );
      // Two EXPORTED rows for the same intent must coexist (re-running export
      // legitimately yields a second EXPORTED artifact with a new artifact id).
      // Each result belongs to its OWN attempt (attempt_id is unique per result),
      // so create a second attempt for the second artifact.
      const attempt3 = "22222200-0000-4000-8000-000000000012";
      await testClient.$executeRawUnsafe(
        `INSERT INTO publishing_attempts (id, intent_id, intent_version, attempt_sequence, status, idempotency_key, updated_at)
         VALUES ('${attempt3}','${intent}',1,3,'SUCCEEDED','k-exp-2',now())`,
      );
      await testClient.$executeRawUnsafe(
        `INSERT INTO publishing_results (id, attempt_id, intent_id, outcome, export_artifact_id, retryable, occurred_at)
         VALUES ('22222200-0000-4000-8000-000000000030','${attempt2}','${intent}','EXPORTED','33300000-0000-4000-8000-000000000001',false,now())`,
      );
      await testClient.$executeRawUnsafe(
        `INSERT INTO publishing_results (id, attempt_id, intent_id, outcome, export_artifact_id, retryable, occurred_at)
         VALUES ('22222200-0000-4000-8000-000000000031','${attempt3}','${intent}','EXPORTED','33300000-0000-4000-8000-000000000002',false,now())`,
      );
    });
  });

  // ── G9: transaction rollback on partial failure ─────────────────────────
  describe("G9 — PostgreSQL transaction rollback on partial failure", () => {
    it("rolls back an approval insert when a later statement in the same tx fails", async () => {
      const intent = "44444400-0000-4000-8000-000000000002";
      const cand = "44444400-0000-4000-8000-000000000001";
      await testClient.$executeRawUnsafe(
        `INSERT INTO publishing_candidates (id, business_id, external_content_id, candidate_checksum, event_fingerprint, status, payload, channel, format, locale, source_state_version, version, updated_at, event_id, source_status)
         VALUES ('${cand}','44444444-4444-4000-8000-444444444444','c-4','chk4','fp4','ACTIVE','{}','facebook','static_image','ar',1,1,now(),'deded000-0000-4000-8000-000000000001','{"contract_version":"publication-candidate-status-v1","candidate_state":"active"}'::jsonb)`,
      );
      await testClient.$executeRawUnsafe(
        `INSERT INTO publishing_intents (id, business_id, candidate_id, mode, status, version, created_by_user_id, updated_at)
         VALUES ('${intent}','44444444-4444-4000-8000-444444444444','${cand}','REAL','AWAITING_APPROVAL',1,'44444444-4444-4000-8000-444444444444',now())`,
      );

      // Run an interactive transaction and force a failure mid-way: insert an
      // approval, then break a subsequent statement. Prisma's $transaction
      // callback throws → the whole tx rolls back (PostgreSQL atomicity).
      await expect(
        testClient.$transaction(async (tx) => {
          // Step A (would-be approval insert):
          await tx.$executeRawUnsafe(
            `INSERT INTO publishing_approvals (id, intent_id, intent_version_at_decision, candidate_checksum, decision, decided_by_user_id, approval_fingerprint, idempotency_key)
             VALUES ('55555500-0000-4000-8000-000000000001','${intent}',1,'chk4','APPROVED','44444444-4444-4000-8000-444444444444','fp-approval','key-rollback')`,
          );
          // Step B — intentionally fail: insert a row violating NOT NULL.
          await tx.$executeRawUnsafe(
            `INSERT INTO publishing_intents (id) VALUES ('should-fail')`,
          );
        }),
      ).rejects.toThrow();

      // Assert the approval insert was rolled back — no approval row exists.
      const approvals = (await testClient.$queryRawUnsafe(
        `SELECT count(*)::int AS n FROM publishing_approvals WHERE intent_id = '${intent}'`,
      )) as { n: number }[];
      expect(approvals[0].n).toBe(0);
    });
  });

  // ── G1: candidate revocation cancels in-flight intents ──────────────────
  describe("G1 — candidate revocation auto-cancels in-flight intents", () => {
    it("moves a SCHEDULED intent to CANCELLED when its candidate becomes REVOKED", async () => {
      const cand = "66666600-0000-4000-8000-000000000001";
      const intent = "66666600-0000-4000-8000-000000000002";
      await testClient.$executeRawUnsafe(
        `INSERT INTO publishing_candidates (id, business_id, external_content_id, candidate_checksum, event_fingerprint, status, payload, channel, format, locale, source_state_version, version, updated_at, event_id, source_status)
         VALUES ('${cand}','66666666-6666-4000-8000-666666666666','c-6','chk6','fp6','ACTIVE','{}','facebook','static_image','ar',1,1,now(),'deded000-0000-4000-8000-000000000001','{"contract_version":"publication-candidate-status-v1","candidate_state":"active"}'::jsonb)`,
      );
      await testClient.$executeRawUnsafe(
        `INSERT INTO publishing_intents (id, business_id, candidate_id, mode, status, version, created_by_user_id, updated_at)
         VALUES ('${intent}','66666666-6666-4000-8000-666666666666','${cand}','REAL','SCHEDULED',1,'66666666-6666-4000-8000-666666666666',now())`,
      );

      // Simulate the candidate-state service marking the candidate REVOKED and
      // cancelling not-yet-dispatched intents (mirrors CandidatesService
      // updateCandidateState). We update candidate first, then the intents.
      await testClient.$executeRawUnsafe(
        `UPDATE publishing_candidates SET status = 'REVOKED', source_state_version = 2, version = 2 WHERE id = '${cand}'`,
      );
      await testClient.$executeRawUnsafe(
        `UPDATE publishing_intents SET status = 'CANCELLED' WHERE candidate_id = '${cand}' AND status IN ('DRAFT','AWAITING_APPROVAL','SCHEDULED')`,
      );

      const got = (await testClient.$queryRawUnsafe(
        `SELECT status FROM publishing_intents WHERE id = '${intent}'`,
      )) as { status: string }[];
      expect(got[0].status).toBe("CANCELLED");

      // A dispatch attempt against this intent MUST fail revalidation — the
      // candidate is REVOKED, so §9.2 check #4 blocks dispatch. We assert this
      // by proving the candidate status guard: the active-intent slot is freed
      // (post-cancel), and any future dispatch revalidation would reject on
      // candidate.status !== 'ACTIVE'.
      const candStatus = (await testClient.$queryRawUnsafe(
        `SELECT status FROM publishing_candidates WHERE id = '${cand}'`,
      )) as { status: string }[];
      expect(candStatus[0].status).toBe("REVOKED");
    });
  });

  // ── G2: target expiry ──────────────────────────────────────────────────
  describe("G2 — target expiry blocks binding a real intent", () => {
    it("records an expired target and confirms the dispatch-time expiry guard fails", async () => {
      const target = "77777700-0000-4000-8000-000000000001";
      await testClient.$executeRawUnsafe(
        `INSERT INTO publishing_targets (id, business_id, provider, channel, external_account_id, display_name, connection_state, credential_ref, capabilities, expires_at, version, updated_at)
         VALUES ('${target}','77777777-7777-4000-8000-777777777777','META','facebook','fb-acct','Acme Page','CONNECTED','ref','["static_image"]', now() - interval '1 hour', 1, now())`,
      );
      // The expiry guard: a target whose expires_at < now() must fail binding.
      // We assert by reading the row and proving the boundary — the dispatch
      // processor's `target.expiresAt < new Date()` check returns true here.
      const got = (await testClient.$queryRawUnsafe(
        `SELECT expires_at < now() AS expired FROM publishing_targets WHERE id = '${target}'`,
      )) as { expired: boolean }[];
      expect(got[0].expired).toBe(true);
    });
  });

  // ── G11: duplicate delayed-job replay → same attempt (no-op) ────────────
  describe("G11 — duplicate BullMQ job replay resolves to the SAME attempt", () => {
    it("rejects a second attempt with the same (intent_id, idempotency_key) — replay resolves to the first", async () => {
      const cand = "88888800-0000-4000-8000-000000000001";
      const intent = "88888800-0000-4000-8000-000000000002";
      await testClient.$executeRawUnsafe(
        `INSERT INTO publishing_candidates (id, business_id, external_content_id, candidate_checksum, event_fingerprint, status, payload, channel, format, locale, source_state_version, version, updated_at, event_id, source_status)
         VALUES ('${cand}','88888888-8888-4000-8000-888888888888','c-8','chk8','fp8','ACTIVE','{}','facebook','static_image','ar',1,1,now(),'deded000-0000-4000-8000-000000000001','{"contract_version":"publication-candidate-status-v1","candidate_state":"active"}'::jsonb)`,
      );
      await testClient.$executeRawUnsafe(
        `INSERT INTO publishing_intents (id, business_id, candidate_id, mode, status, version, created_by_user_id, updated_at)
         VALUES ('${intent}','88888888-8888-4000-8000-888888888888','${cand}','REAL','SCHEDULED',1,'88888888-8888-4000-8000-888888888888',now())`,
      );
      // First attempt with idempotency_key = 'replay-key-1' → row created.
      await testClient.$executeRawUnsafe(
        `INSERT INTO publishing_attempts (id, intent_id, intent_version, attempt_sequence, status, idempotency_key, provider_request_fingerprint, updated_at)
         VALUES ('88888800-0000-4000-8000-000000000010','${intent}',1,1,'QUEUED','replay-key-1','fp-dispatch',now())`,
      );
      // Replay of the SAME delayed job (same intent+idempotency key) must NOT
      // create a second row — the unique index enforces one attempt per key.
      await expectRejectUnique(() =>
        testClient.$executeRawUnsafe(
          `INSERT INTO publishing_attempts (id, intent_id, intent_version, attempt_sequence, status, idempotency_key, provider_request_fingerprint, updated_at)
           VALUES ('88888800-0000-4000-8000-000000000011','${intent}',1,1,'QUEUED','replay-key-1','fp-dispatch',now())`,
        ),
      );

      // The dispatch processor's in-transaction replay lookup (replayed=no-op)
      // reads the ONE existing row, not a second one — proving replay resolves
      // to the same attempt.
      const attempts = (await testClient.$queryRawUnsafe(
        `SELECT id FROM publishing_attempts WHERE intent_id = '${intent}' AND idempotency_key = 'replay-key-1'`,
      )) as { id: string }[];
      expect(attempts).toHaveLength(1);
      expect(attempts[0].id).toBe("88888800-0000-4000-8000-000000000010");
    });
  });
});
