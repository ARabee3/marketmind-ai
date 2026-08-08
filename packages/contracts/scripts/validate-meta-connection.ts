/**
 * meta-connection-v1 contract checks (issue #175).
 *
 * Validates the frozen-safe surface types and the credential-free guarantee
 * over the example selection payload. The OAuth journey is ADDITIVE to the
 * publishing-v1 boundary: dispatch/callback/result contracts are untouched.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  assertMetaSelectionIsCredentialFree,
  validateMetaConnectionResultCode,
  type MetaPendingSelectionV1,
} from "../src/publishing/meta-connection.js";

async function run(): Promise<void> {
  // Result codes are the only values a callback redirect may carry.
  assert.equal(validateMetaConnectionResultCode("success"), true);
  assert.equal(validateMetaConnectionResultCode("cancelled"), true);
  assert.equal(validateMetaConnectionResultCode("expired"), true);
  assert.equal(validateMetaConnectionResultCode("denied"), true);
  assert.equal(validateMetaConnectionResultCode("unknown"), true);
  assert.equal(validateMetaConnectionResultCode("token-leak"), false);

  // The example pending selection must be credential-free.
  const example = JSON.parse(
    await readFile(
      resolve(
        process.cwd(),
        "examples/meta-pending-selection.example.json",
      ),
      "utf8",
    ),
  ) as MetaPendingSelectionV1;
  assert.equal(example.contract_version, "meta-connection-v1");
  assert.equal(assertMetaSelectionIsCredentialFree(example), true);
  assert.ok(example.options.length > 0);
  assert.equal(example.options[0].page.channel, "facebook");
  assert.ok(Array.isArray(example.options[0].page.blockers));

  console.log("meta-connection-v1 examples and credential-free surface are valid.");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
