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
assert.equal(start.week_context_id, null);
assert.equal(start.week_context_checksum, null);
assert.equal(start.bounds.tool_calls_limit, 8);
assert.equal(start.bounds.replans_limit, 2);

const resume = await loadJson("orchestration-resume.request.json");
assert.equal(resume.run_id, resume.checkpoint_thread_id);
assert.equal(resume.decision_binding.run_id, resume.run_id);
assert.equal(resume.decision_binding.business_id, resume.business_id);
assert.equal(resume.decision_binding.strategy_checksum.length, 64);

const event = await loadJson("orchestration-event.example.json");
assert.equal(event.event_type, "run_created");
assert.equal(event.seq, 1);

const state = await loadJson("orchestration-state.example.json");
assert.equal(state.contract_version, "orchestration-v1");
assert.equal(state.status, "queued");
assert.equal(state.current_stage, "prepare");
assert.equal(state.bounds.replans_limit, 2);
assert.equal(state.research_pack, null);
assert.equal(state.strategy.decision_binding, null);

const result = await loadJson("orchestration-result.example.json");
assert.equal(result.checkpoint_thread_id, result.run_id);
assert.equal(result.state.run_id, result.run_id);
assert.equal(result.error, null);

const invalidResume = await loadJson(
  "orchestration-resume-cross-scope.invalid.json",
);
assert.notEqual(invalidResume.checkpoint_thread_id, invalidResume.run_id);
assert.notEqual(invalidResume.decision_binding.run_id, invalidResume.run_id);
assert.notEqual(
  invalidResume.decision_binding.business_id,
  invalidResume.business_id,
);

console.log("Orchestration contract examples are valid.");
