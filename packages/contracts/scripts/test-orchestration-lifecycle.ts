import assert from "node:assert/strict";
import {
  ORCHESTRATION_ALLOWED_TRANSITIONS,
  ORCHESTRATION_STATUSES,
  OrchestrationLifecycleError,
  canTransitionOrchestrationRun,
  transitionOrchestrationRun,
} from "../src/orchestration/orchestration-lifecycle.ts";

assert.equal(canTransitionOrchestrationRun("queued", "running"), true);
assert.equal(
  canTransitionOrchestrationRun("awaiting_strategy_approval", "running"),
  true,
);
assert.equal(canTransitionOrchestrationRun("completed", "running"), false);
assert.equal(transitionOrchestrationRun("running", "failed"), "failed");

for (const from of ORCHESTRATION_STATUSES) {
  for (const to of ORCHESTRATION_STATUSES) {
    const allowed = ORCHESTRATION_ALLOWED_TRANSITIONS[from].includes(to);
    assert.equal(canTransitionOrchestrationRun(from, to), allowed);
    if (allowed) {
      assert.equal(transitionOrchestrationRun(from, to), to);
    } else {
      assert.throws(
        () => transitionOrchestrationRun(from, to),
        (error: unknown) =>
          error instanceof OrchestrationLifecycleError &&
          error.code === "ORCHESTRATION_INVALID_TRANSITION",
      );
    }
  }
}

assert.throws(
  () => transitionOrchestrationRun("completed", "running"),
  (error: unknown) =>
    error instanceof OrchestrationLifecycleError &&
    error.code === "ORCHESTRATION_INVALID_TRANSITION",
);

console.log(
  "Orchestration lifecycle transitions are valid and illegal edges are rejected.",
);
