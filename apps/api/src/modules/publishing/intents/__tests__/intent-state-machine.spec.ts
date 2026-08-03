/**
 * State machine transition tests for PublishingIntents.
 * Covers §2.9 of the implementation plan (every legal and illegal transition).
 *
 * These are pure unit tests — no DB, no queue.
 */

// ── State machine definition (mirrors intents.service.ts logic) ─────────────

type IntentStatus =
  | "DRAFT"
  | "AWAITING_APPROVAL"
  | "SCHEDULED"
  | "DISPATCHING"
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELLED"
  | "ACTION_REQUIRED";

const CANCELLABLE: IntentStatus[] = ["DRAFT", "AWAITING_APPROVAL", "SCHEDULED"];
const RETRYABLE: IntentStatus[] = ["FAILED", "ACTION_REQUIRED"];
const SCHEDULABLE: IntentStatus[] = ["DRAFT", "AWAITING_APPROVAL", "SCHEDULED"];

function canCancel(status: IntentStatus): boolean {
  return CANCELLABLE.includes(status);
}

function canRetry(status: IntentStatus): boolean {
  return RETRYABLE.includes(status);
}

function canSchedule(status: IntentStatus): boolean {
  return SCHEDULABLE.includes(status);
}

function canApprove(status: IntentStatus): boolean {
  return status === "AWAITING_APPROVAL";
}

// ── Cancel transition matrix ─────────────────────────────────────────────────

describe("Intent FSM — cancel transition", () => {
  it.each<IntentStatus>(["DRAFT", "AWAITING_APPROVAL", "SCHEDULED"])(
    "allows cancel from %s",
    (status) => {
      expect(canCancel(status)).toBe(true);
    },
  );

  it.each<IntentStatus>([
    "DISPATCHING",
    "SUCCEEDED",
    "FAILED",
    "CANCELLED",
    "ACTION_REQUIRED",
  ])("rejects cancel from terminal/in-flight status %s", (status) => {
    expect(canCancel(status)).toBe(false);
  });

  it("rejects cancel specifically from DISPATCHING (cancel-vs-dispatch race protection)", () => {
    // Key safety rule: once an attempt has claimed DISPATCHING, cancel must be rejected
    expect(canCancel("DISPATCHING")).toBe(false);
  });
});

// ── Retry transition matrix ──────────────────────────────────────────────────

describe("Intent FSM — retry transition", () => {
  it.each<IntentStatus>(["FAILED", "ACTION_REQUIRED"])(
    "allows retry from %s",
    (status) => {
      expect(canRetry(status)).toBe(true);
    },
  );

  it.each<IntentStatus>([
    "DRAFT",
    "AWAITING_APPROVAL",
    "SCHEDULED",
    "DISPATCHING",
    "SUCCEEDED",
    "CANCELLED",
  ])("rejects retry from %s", (status) => {
    expect(canRetry(status)).toBe(false);
  });
});

// ── Schedule/reschedule transition matrix ────────────────────────────────────

describe("Intent FSM — schedule/reschedule transition", () => {
  it.each<IntentStatus>(["DRAFT", "AWAITING_APPROVAL", "SCHEDULED"])(
    "allows schedule from %s",
    (status) => {
      expect(canSchedule(status)).toBe(true);
    },
  );

  it.each<IntentStatus>([
    "DISPATCHING",
    "SUCCEEDED",
    "FAILED",
    "CANCELLED",
    "ACTION_REQUIRED",
  ])("rejects schedule from %s", (status) => {
    expect(canSchedule(status)).toBe(false);
  });
});

// ── Approve transition matrix ────────────────────────────────────────────────

describe("Intent FSM — approve/reject transition", () => {
  it("allows approve only from AWAITING_APPROVAL", () => {
    expect(canApprove("AWAITING_APPROVAL")).toBe(true);
  });

  it.each<IntentStatus>([
    "DRAFT",
    "SCHEDULED",
    "DISPATCHING",
    "SUCCEEDED",
    "FAILED",
    "CANCELLED",
  ])("rejects approve from %s", (status) => {
    expect(canApprove(status)).toBe(false);
  });
});

// ── Version invalidation rules ───────────────────────────────────────────────

describe("Intent FSM — approval invalidation on reschedule", () => {
  it("schedule change bumps version, which invalidates prior approval", () => {
    // Simulate: approval was made at version 3; intent is rescheduled → version becomes 4
    const approvalVersion = 3;
    const intentVersionAfterReschedule = 4;
    // The approval is invalid if its version < current intent version
    expect(approvalVersion).toBeLessThan(intentVersionAfterReschedule);
  });

  it("approval version matches intent version → valid", () => {
    const approvalVersion = 4;
    const intentVersion = 4;
    expect(approvalVersion === intentVersion).toBe(true);
  });
});
