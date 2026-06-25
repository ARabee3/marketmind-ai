import { readFile } from "node:fs/promises";

const examplesUrl = new URL("../examples/", import.meta.url);

const discoveryStatuses = new Set([
  "not_started",
  "researching",
  "partial_ready",
  "ready_for_chat",
  "in_progress",
  "summary_ready",
  "confirmed",
  "research_failed",
  "failed",
  "cancelled",
]);

const progressStages = new Set(["queued", "metadata", "search", "ai_start", "ready", "failed"]);
const progressStatuses = new Set(["started", "progress", "complete", "failed"]);
const aiActions = new Set([
  "ask_next_question",
  "ask_clarification",
  "produce_profile_draft",
  "safe_failure",
]);
const errorCodes = new Set([
  "DISCOVERY_SESSION_NOT_FOUND",
  "DISCOVERY_SESSION_STATE_CONFLICT",
  "DISCOVERY_RESEARCH_CAP_EXCEEDED",
  "DISCOVERY_AI_SERVICE_UNAVAILABLE",
  "DISCOVERY_AI_BAD_RESPONSE",
  "DISCOVERY_PROFILE_ALREADY_CONFIRMED",
  "VALIDATION_FAILED",
  "UNAUTHORIZED",
  "FORBIDDEN",
]);

async function loadJson(name) {
  const raw = await readFile(new URL(name, examplesUrl), "utf8");
  return JSON.parse(raw);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertString(value, label) {
  assert(typeof value === "string" && value.length > 0, `${label} must be a non-empty string`);
}

function assertStatus(value, label) {
  assert(discoveryStatuses.has(value), `${label} has unsupported status: ${value}`);
}

function assertProgressEvent(event, index, expectedSessionId) {
  assert(event.type === "progress", `progress[${index}] type must be progress`);
  assert(event.session_id === expectedSessionId, `progress[${index}] session id mismatch`);
  assert(event.seq === index + 1, `progress[${index}] seq must be ${index + 1}`);
  assert(progressStages.has(event.stage), `progress[${index}] has invalid stage ${event.stage}`);
  assert(progressStatuses.has(event.status), `progress[${index}] has invalid status ${event.status}`);
  assertString(event.message_key, `progress[${index}].message_key`);
  assertString(event.message_text, `progress[${index}].message_text`);
}

function assertProfileDraft(draft, label) {
  assertString(draft.id, `${label}.id`);
  assertString(draft.session_id, `${label}.session_id`);
  assert(Number.isInteger(draft.version), `${label}.version must be an integer`);
  assert(
    ["draft", "ready_for_confirmation", "confirmed", "superseded"].includes(draft.status),
    `${label}.status is invalid`,
  );
  assert(typeof draft.confirmed_facts === "object" && !Array.isArray(draft.confirmed_facts), `${label}.confirmed_facts must be an object`);
  assert(Array.isArray(draft.research_observations), `${label}.research_observations must be an array`);
  assert(Array.isArray(draft.uncertainties), `${label}.uncertainties must be an array`);
  assert(Array.isArray(draft.owner_goals), `${label}.owner_goals must be an array`);
  assert(Array.isArray(draft.strategy_relevant_notes), `${label}.strategy_relevant_notes must be an array`);
}

function assertIntelligence(intelligence, label) {
  assert(["running", "partial", "complete", "failed"].includes(intelligence.status), `${label}.status is invalid`);
  assert(["metadata_only", "free_search", "provider_later"].includes(intelligence.search_mode), `${label}.search_mode is invalid`);
  assert(Array.isArray(intelligence.source_refs), `${label}.source_refs must be an array`);
  assert(Array.isArray(intelligence.research_observations), `${label}.research_observations must be an array`);
  assert(Array.isArray(intelligence.conversation_hooks), `${label}.conversation_hooks must be an array`);
  assert(Array.isArray(intelligence.knowledge_gaps), `${label}.knowledge_gaps must be an array`);

  for (const observation of intelligence.research_observations) {
    if (observation.status === "discarded") {
      assertString(observation.discard_reason, `${label}.discarded_observation.discard_reason`);
    }

    if (observation.visibility === "owner_visible") {
      assert(
        observation.source_ref_id || observation.metadata?.source_label,
        `${label}.owner_visible_observation needs a source ref or label`,
      );
    }
  }
}

const startRequest = await loadJson("discovery-start.request.json");
assertString(startRequest.intake?.business_name, "startRequest.intake.business_name");
assertString(startRequest.intake?.business_type, "startRequest.intake.business_type");
assertString(startRequest.intake?.city, "startRequest.intake.city");

const startResponse = await loadJson("discovery-start.response.json");
assert(startResponse.status === "researching", "start response must begin in researching");
assertString(startResponse.session_id, "startResponse.session_id");
assert(startResponse.progress_ws_url.includes(startResponse.session_id), "progress URL must include session id");
assert(startResponse.status_url.includes(startResponse.session_id), "status URL must include session id");

const progressTranscript = await loadJson("discovery-progress.transcript.json");
assert(Array.isArray(progressTranscript), "progress transcript must be an array");
progressTranscript.forEach((event, index) => assertProgressEvent(event, index, startResponse.session_id));
assert(progressTranscript.at(-1).stage === "ready", "progress transcript should end at ready");

const statusResponse = await loadJson("discovery-status.response.json");
assert(statusResponse.session_id === startResponse.session_id, "status response session id mismatch");
assertStatus(statusResponse.status, "statusResponse.status");
assert(statusResponse.strategy_locked === true, "strategy must stay locked before confirmation");
assertIntelligence(statusResponse.intelligence, "statusResponse.intelligence");

const respondResponse = await loadJson("discovery-respond.response.json");
assertStatus(respondResponse.status, "respondResponse.status");
assert(respondResponse.strategy_locked === true, "strategy must stay locked during chat");

const summarizeResponse = await loadJson("discovery-summarize.response.json");
assert(summarizeResponse.status === "summary_ready", "summarize response must be summary_ready");
assert(summarizeResponse.strategy_locked === true, "strategy must stay locked at summary");
assertProfileDraft(summarizeResponse.profile_draft, "summarizeResponse.profile_draft");

const confirmRequest = await loadJson("discovery-confirm-profile.request.json");
assert(confirmRequest.owner_confirmation === true, "confirm request must explicitly confirm");
assert(confirmRequest.profile_draft_id === summarizeResponse.profile_draft.id, "confirm request must reference the draft");

const confirmResponse = await loadJson("discovery-confirm-profile.response.json");
assert(confirmResponse.status === "confirmed", "confirm response must be confirmed");
assert(confirmResponse.strategy_locked === false, "strategy unlocks only after confirmation");

const aiStartResponse = await loadJson("internal-ai-discovery-start.response.json");
assert(aiActions.has(aiStartResponse.action), "AI start action is invalid");
assertString(aiStartResponse.next_question, "aiStartResponse.next_question");

const aiSummarizeResponse = await loadJson("internal-ai-discovery-summarize.response.json");
assert(aiActions.has(aiSummarizeResponse.action), "AI summarize action is invalid");
assert(aiSummarizeResponse.action === "produce_profile_draft", "AI summarize should produce a profile draft");
assertProfileDraft(aiSummarizeResponse.profile_draft, "aiSummarizeResponse.profile_draft");

const errorEnvelope = await loadJson("error-envelope.response.json");
assert(errorCodes.has(errorEnvelope.error?.code), "error envelope code is invalid");
assertString(errorEnvelope.error.message, "errorEnvelope.error.message");
assertString(errorEnvelope.error.request_id, "errorEnvelope.error.request_id");
assert(typeof errorEnvelope.error.retryable === "boolean", "errorEnvelope.error.retryable must be boolean");

console.log("Prepared Discovery contract examples are valid.");
