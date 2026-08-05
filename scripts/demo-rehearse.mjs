#!/usr/bin/env node
/**
 * demo:rehearse — automated zero-credentials publishing demo rehearsal
 * (IMPLEMENTATION_PLAN_123.md §4.8 H1 + §5 runbook).
 *
 * Executes the runbook against a freshly reset throwaway DB:
 *   1. apps/api/.env.test → active .env (backed up + restored on exit)
 *   2. prisma migrate reset (applies all migrations cleanly)
 *   3. redis FLUSHALL (no stale BullMQ delayed jobs)
 *   4. onboard a truthful demo owner + business (seed:demo-owner)
 *   5. seed the publishing demo in zero-credentials mode
 *      (MANUAL_EXPORT + SIMULATION intents — no META creds, no target, no queue)
 *   6. mint a real owner JWT with the API's own access secret
 *   7. run the Playwright rehearsal spec against the REAL API (:3101) + web
 *      (apps/web/playwright.rehearsal.config.ts) and assert truthful
 *      EXPORTED / SIMULATED rendering in ar + en (screenshots captured)
 *
 * Requires the local Postgres + Redis stack (npm run docker:up).
 * Deliberately NOT part of `npm run check`: this spec resets the shared
 * throwaway test DB, so it must not interleave with the API e2e suite.
 *
 * Usage: npm run demo:rehearse
 */
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { createRequire } from "node:module";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const apiDir = path.join(root, "apps/api");
const webDir = path.join(root, "apps/web");
const envTest = path.join(apiDir, ".env.test");
const envActive = path.join(apiDir, ".env");
const envBackup = path.join(apiDir, ".env.rehearse-backup");
const stateFile = path.join(webDir, ".rehearsal-state.json");

const require = createRequire(import.meta.url);

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, {
    cwd: opts.cwd ?? root,
    stdio: opts.stdio ?? "inherit",
    env: opts.env ?? process.env,
    encoding: "utf8",
  });
  if (res.error) throw res.error;
  if (res.status !== 0) {
    process.exit(res.status ?? 1);
  }
  return res;
}

function readEnv(file) {
  const out = {};
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)="?([^"]*)"?$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function lastJsonLine(stdout) {
  const lines = String(stdout).trim().split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const candidate = lines.slice(i).join("\n");
    try {
      return JSON.parse(candidate);
    } catch {
      // keep scanning for the last JSON block
    }
  }
  throw new Error(`no JSON block found in output:\n${String(stdout).slice(-2000)}`);
}

function hasBin(cmd) {
  const res = spawnSync("which", [cmd], { stdio: "ignore" });
  return res.status === 0;
}

const backupExisted = fs.existsSync(envActive);
if (backupExisted) fs.copyFileSync(envActive, envBackup);
const restore = () => {
  if (backupExisted) {
    fs.copyFileSync(envBackup, envActive);
    fs.rmSync(envBackup, { force: true });
  } else {
    fs.rmSync(envActive, { force: true });
  }
};

try {
  if (!fs.existsSync(envTest)) {
    throw new Error(`missing ${envTest} — cannot run the rehearsal`);
  }
  fs.copyFileSync(envTest, envActive);

  console.log("\n[demo:rehearse] 1/7 resetting the throwaway test DB");
  run("npx", ["prisma", "migrate", "reset", "--force", "--skip-seed"], {
    cwd: apiDir,
  });

  console.log("\n[demo:rehearse] 2/7 flushing Redis (no stale BullMQ jobs)");
  const testEnv = readEnv(envTest);
  const redisUrl = testEnv.REDIS_URL ?? "redis://localhost:6379";
  // Prefer a host redis-cli; fall back to the docker-compose container.
  const flushCmd = hasBin("redis-cli")
    ? { cmd: "redis-cli", args: ["-u", redisUrl, "FLUSHALL"] }
    : { cmd: "docker", args: ["exec", "marketmind-redis", "redis-cli", "FLUSHALL"] };
  const flush = run(flushCmd.cmd, flushCmd.args, { stdio: "pipe" });
  if (!String(flush.stdout).trim().startsWith("OK")) {
    throw new Error(`redis FLUSHALL failed: ${flush.stdout}`);
  }
  console.log(`  redis FLUSHALL OK (${redisUrl})`);

  console.log("\n[demo:rehearse] 3/7 onboarding the demo owner + business");
  const owner = lastJsonLine(
    run("npx", ["ts-node", "scripts/seed-demo-owner.ts"], {
      cwd: apiDir,
      stdio: "pipe",
    }).stdout,
  );
  const ownerId = owner.ownerId;
  const businessId = owner.businessId;
  const ownerRefreshJwt = owner.ownerRefreshJwt;
  const ownerEmail = testEnv.DEMO_OWNER_EMAIL ?? "demo-owner@marketmind.test";
  console.log(`  owner=${ownerId} business=${businessId}`);

  console.log("\n[demo:rehearse] 4/7 seeding the zero-credentials publishing demo");
  const seed = lastJsonLine(
    run("npx", ["ts-node", "scripts/seed-publishing-demo.ts"], {
      cwd: apiDir,
      stdio: "pipe",
      env: { ...process.env, META_TEST_PAGE_ID: "" },
    }).stdout,
  );
  const intentExportId = seed.intentExportId;
  const intentSimulationId = seed.intentSimulationId;
  if (!intentExportId || !intentSimulationId) {
    throw new Error(`seed did not produce both demo intents: ${JSON.stringify(seed)}`);
  }

  console.log("\n[demo:rehearse] 5/7 minting the owner JWT");
  const jwt = require("jsonwebtoken");
  const accessSecret = testEnv.JWT_ACCESS_SECRET;
  if (!accessSecret) {
    throw new Error("JWT_ACCESS_SECRET missing from .env.test");
  }
  const expiresIn = testEnv.JWT_ACCESS_EXPIRES_IN ?? "15m";
  const ownerJwt = jwt.sign(
    { sub: ownerId, email: ownerEmail, roles: ["OWNER"] },
    accessSecret,
    { expiresIn },
  );

  fs.writeFileSync(
    stateFile,
    JSON.stringify(
      {
        apiBase: "http://localhost:3101/api/v1",
        ownerJwt,
        ownerRefreshJwt,
        ownerId,
        intentExportId,
        intentSimulationId,
        businessId,
        ownerEmail,
      },
      null,
      2,
    ),
  );
  console.log(`  state → ${stateFile}`);

  console.log("\n[demo:rehearse] 6/7 building the API for :3101");
  run("npm", ["run", "build", "-w", "@marketmind/api"]);

  console.log("\n[demo:rehearse] 7/7 Playwright rehearsal (real API, ar + en)");
  run(
    "npx",
    ["playwright", "test", "--config", "playwright.rehearsal.config.ts"],
    { cwd: webDir },
  );

  console.log("\n[demo:rehearse] done — report + screenshots in apps/web/test-results/");
} catch (e) {
  console.error("\n[demo:rehearse] failed:", e);
  process.exitCode = 1;
} finally {
  restore();
  console.log("  (apps/api/.env restored)");
}
