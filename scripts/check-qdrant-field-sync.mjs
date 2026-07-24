#!/usr/bin/env node
// Qdrant payload field-sync check (PR #94 review response, issue #69).
//
// Asserts the TypeScript `QDRANT_KNOWLEDGE_POINT_FIELDS` array
// (apps/api/src/modules/marketing-knowledge/marketing-knowledge-rebuild.service.ts)
// and the Python `QdrantKnowledgePoint` Pydantic model
// (services/ai/app/qdrant/schemas.py) declare the exact same field set.
//
// There is no shared type across the TS/Python boundary, so this script is
// the automated gate that replaces the old "manual sync reminder": a drift
// here fails `npm run check:qdrant-field-sync` (and therefore `npm run check`).
//
// Both sides are compared as sorted sets — the two languages do not declare
// fields in the same order, and ordering differences must not cause false
// failures. A real drift (a field added to one side but not the other) is the
// only thing this check flags.

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { existsSync } from "node:fs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, {
    cwd: repoRoot,
    encoding: "utf8",
    ...options,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `Command failed (${cmd} ${args.join(" ")}):\n${result.stderr || result.stdout}`,
    );
  }
  return result.stdout;
}

function getPythonFields() {
  const stdout = run("uv", [
    "--directory",
    "services/ai",
    "run",
    "python",
    "-c",
    "import json; from app.qdrant.schemas import QdrantKnowledgePoint; print(json.dumps(sorted(QdrantKnowledgePoint.model_fields.keys())))",
  ]);
  return JSON.parse(stdout.trim());
}

function getTypeScriptFields() {
  // `QDRANT_KNOWLEDGE_POINT_FIELDS` is a plain `as const` string-literal array
  // with no runtime side effects. We import it directly via tsx (a repo
  // devDependency) rather than text-scraping the source, so a real import is
  // the source of truth — not a regex.
  const tsxPath = resolve(repoRoot, "node_modules/.bin/tsx");
  if (!existsSync(tsxPath)) {
    throw new Error(
      "tsx not found at node_modules/.bin/tsx — run `npm install` first (tsx is a root devDependency).",
    );
  }
  const modulePath = resolve(
    repoRoot,
    "apps/api/src/modules/marketing-knowledge/marketing-knowledge-rebuild.service.ts",
  );
  const stdout = run(tsxPath, [
    "-e",
    `import { QDRANT_KNOWLEDGE_POINT_FIELDS } from ${JSON.stringify(modulePath)}; console.log(JSON.stringify([...QDRANT_KNOWLEDGE_POINT_FIELDS].sort()));`,
  ]);
  return JSON.parse(stdout.trim());
}

function symmetricDifference(a, b) {
  const setA = new Set(a);
  const setB = new Set(b);
  const onlyTs = [...setA].filter((x) => !setB.has(x));
  const onlyPy = [...setB].filter((x) => !setA.has(x));
  return { onlyTs, onlyPy };
}

function main() {
  const tsFields = getTypeScriptFields();
  const pyFields = getPythonFields();

  const tsSorted = [...tsFields].sort();
  const pySorted = [...pyFields].sort();

  if (tsSorted.length !== tsFields.length || pySorted.length !== pyFields.length) {
    console.error(
      "Qdrant payload field mismatch: one side declares duplicate field names.",
    );
    console.error(`TS fields: ${JSON.stringify(tsFields)}`);
    console.error(`Python fields: ${JSON.stringify(pyFields)}`);
    process.exit(1);
  }

  if (tsSorted.join("|") === pySorted.join("|")) {
    console.log(
      `Qdrant field-sync OK: TS and Python agree on ${tsSorted.length} fields.`,
    );
    return;
  }

  const { onlyTs, onlyPy } = symmetricDifference(tsSorted, pySorted);
  console.error(
    "Qdrant payload field mismatch: TS has fields that Python doesn't; Python has fields that TS doesn't. Update both sides to match.",
  );
  console.error(`  TS fields      : ${JSON.stringify(tsSorted)}`);
  console.error(`  Python fields  : ${JSON.stringify(pySorted)}`);
  console.error(`  Only in TS     : ${JSON.stringify(onlyTs)}`);
  console.error(`  Only in Python : ${JSON.stringify(onlyPy)}`);
  process.exit(1);
}

main();
