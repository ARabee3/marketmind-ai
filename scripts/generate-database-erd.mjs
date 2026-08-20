#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DBML_CLI_VERSION = "10.1.1";
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");
const schemaPath = join(repositoryRoot, "apps/api/prisma/schema.prisma");
const outputPath = join(
  repositoryRoot,
  "Docs/technical-and-ai-docs/MARKETMIND_DATABASE_ERD.dbml",
);
const localPrismaBinary = join(
  repositoryRoot,
  "node_modules/.bin",
  process.platform === "win32" ? "prisma.cmd" : "prisma",
);
const prismaBinary = process.env.PRISMA_CLI_BIN || localPrismaBinary;
const npxBinary = process.platform === "win32" ? "npx.cmd" : "npx";

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    stdio: "inherit",
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status}`);
  }
}

function countMatches(text, pattern) {
  return [...text.matchAll(pattern)].length;
}

if (!existsSync(schemaPath)) {
  throw new Error(`Prisma schema not found at ${schemaPath}`);
}

if (!existsSync(prismaBinary)) {
  throw new Error(
    `Prisma CLI not found at ${prismaBinary}. Run npm install before generating the ERD.`,
  );
}

const temporaryDirectory = mkdtempSync(join(tmpdir(), "marketmind-erd-"));
const sqlPath = join(temporaryDirectory, "marketmind-schema.sql");
const generatedDbmlPath = join(temporaryDirectory, "marketmind-schema.dbml");
const validationSqlPath = join(temporaryDirectory, "marketmind-roundtrip.sql");

try {
  run(prismaBinary, [
    "migrate",
    "diff",
    "--from-empty",
    "--to-schema-datamodel",
    schemaPath,
    "--script",
    "--output",
    sqlPath,
  ]);

  run(npxBinary, [
    "--yes",
    `--package=@dbml/cli@${DBML_CLI_VERSION}`,
    "sql2dbml",
    sqlPath,
    "--postgres",
    "-o",
    generatedDbmlPath,
  ]);

  const schema = readFileSync(schemaPath, "utf8");
  const generatedDbml = readFileSync(generatedDbmlPath, "utf8").trimEnd();
  const expectedCounts = {
    models: countMatches(schema, /^model\s+\w+\s*\{/gm),
    enums: countMatches(schema, /^enum\s+\w+\s*\{/gm),
    relations: countMatches(schema, /@relation\([^\n]*\bfields\s*:/g),
  };
  const actualCounts = {
    models: countMatches(generatedDbml, /^Table\s+/gm),
    enums: countMatches(generatedDbml, /^Enum\s+/gm),
    relations: countMatches(generatedDbml, /^Ref\s+/gm),
  };

  for (const key of Object.keys(expectedCounts)) {
    if (expectedCounts[key] !== actualCounts[key]) {
      throw new Error(
        `Generated DBML ${key} count mismatch: expected ${expectedCounts[key]}, got ${actualCounts[key]}`,
      );
    }
  }

  const header = `// GENERATED FILE - DO NOT EDIT DIRECTLY.
// Source: apps/api/prisma/schema.prisma
// Regenerate: node scripts/generate-database-erd.mjs

Project marketmind_ai {
  database_type: 'PostgreSQL'
  Note: 'Complete physical MarketMind AI database ERD generated from the Prisma schema.'
}`;

  writeFileSync(outputPath, `${header}\n\n${generatedDbml}\n`, "utf8");

  run(npxBinary, [
    "--yes",
    `--package=@dbml/cli@${DBML_CLI_VERSION}`,
    "dbml2sql",
    outputPath,
    "--postgres",
    "-o",
    validationSqlPath,
  ]);

  console.log(
    `Generated ${outputPath} (${actualCounts.models} tables, ${actualCounts.enums} enums, ${actualCounts.relations} relationships).`,
  );
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
