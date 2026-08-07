import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const examplesUrl = new URL("../examples/", import.meta.url);

async function loadJson(name) {
  return JSON.parse(await readFile(new URL(name, examplesUrl), "utf8"));
}

const start = await loadJson("orchestration-start.request.json");
assert.equal(start.contract_version, "orchestration-v1");
assert.equal(start.graph_name, "campaign-v1");
assert.equal(start.requested_week_number, 1);
assert.equal(start.confirmed_profile_checksum.length, 64);

const state = await loadJson("orchestration-state.example.json");
assert.equal(state.contract_version, "orchestration-v1");
assert.equal(state.status, "queued");
assert.equal(state.current_stage, "prepare");
assert.equal(state.bounds.replans_limit, 2);
assert.equal(state.research_pack, null);

console.log("Orchestration contract examples are valid.");
