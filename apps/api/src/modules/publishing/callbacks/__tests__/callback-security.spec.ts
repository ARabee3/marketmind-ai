import * as crypto from "crypto";

/** Mirrors the logic in callbacks.controller.ts for isolated unit testing. */

const CALLBACK_WINDOW_MS = 5 * 60 * 1000;

function isTimestampValid(timestamp: string): boolean {
  const ts = new Date(timestamp);
  if (isNaN(ts.getTime())) return false;
  return Math.abs(Date.now() - ts.getTime()) <= CALLBACK_WINDOW_MS;
}

function verifySignature(
  secret: string,
  body: {
    attemptId: string;
    outcome: string;
    nonce: string;
    timestamp: string;
    signature: string;
  },
): boolean {
  const canonical = [
    body.attemptId,
    body.outcome,
    body.nonce,
    body.timestamp,
  ].join(":");
  const expected = crypto
    .createHmac("sha256", secret)
    .update(canonical)
    .digest();
  let actual: Buffer;
  try {
    actual = Buffer.from(body.signature, "hex");
  } catch {
    return false;
  }
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}

const SECRET = "test-signing-secret-32chars-long!!";

function buildValidCallback(
  overrides: Partial<{
    timestamp: string;
    outcome: string;
    signature: string;
  }> = {},
) {
  const timestamp = overrides.timestamp ?? new Date().toISOString();
  const outcome = overrides.outcome ?? "published";
  const nonce = crypto.randomUUID();
  const canonical = ["attempt-1", outcome, nonce, timestamp].join(":");
  const signature =
    overrides.signature ??
    crypto.createHmac("sha256", SECRET).update(canonical).digest("hex");
  return { attemptId: "attempt-1", outcome, nonce, timestamp, signature };
}

describe("Callback security pipeline", () => {
  describe("Timestamp replay-window", () => {
    it("accepts a timestamp within the 5-minute window", () => {
      const ts = new Date(Date.now() - 60_000).toISOString(); // 1 min ago
      expect(isTimestampValid(ts)).toBe(true);
    });

    it("rejects a timestamp older than 5 minutes (stale replay)", () => {
      const ts = new Date(Date.now() - 6 * 60 * 1000).toISOString(); // 6 min ago
      expect(isTimestampValid(ts)).toBe(false);
    });

    it("rejects a future timestamp beyond the window", () => {
      const ts = new Date(Date.now() + 6 * 60 * 1000).toISOString();
      expect(isTimestampValid(ts)).toBe(false);
    });

    it("rejects a garbage timestamp string", () => {
      expect(isTimestampValid("not-a-date")).toBe(false);
    });
  });

  describe("HMAC signature verification (constant-time)", () => {
    it("accepts a correctly signed payload", () => {
      const cb = buildValidCallback();
      expect(verifySignature(SECRET, cb)).toBe(true);
    });

    it("rejects a tampered outcome field", () => {
      const cb = buildValidCallback();
      // Signature was built for 'published' but we mutate the outcome
      expect(verifySignature(SECRET, { ...cb, outcome: "failed" })).toBe(false);
    });

    it("rejects a wrong signature string", () => {
      const cb = buildValidCallback({ signature: "deadbeef".repeat(8) });
      expect(verifySignature(SECRET, cb)).toBe(false);
    });

    it("rejects an empty signature", () => {
      const cb = buildValidCallback({ signature: "" });
      expect(verifySignature(SECRET, cb)).toBe(false);
    });

    it("rejects a non-hex signature", () => {
      const cb = buildValidCallback({ signature: "not-hex!!!!" });
      // Buffer.from with invalid hex returns garbage bytes → comparison fails
      expect(verifySignature(SECRET, cb)).toBe(false);
    });

    it("accepts an identical payload replayed within the window (idempotent)", () => {
      // Same nonce, same signature → verifySignature still returns true (replay detection
      // is a separate DB-level check, not signature verification)
      const cb = buildValidCallback();
      expect(verifySignature(SECRET, cb)).toBe(true);
      // Second call with identical payload also passes signature check
      expect(verifySignature(SECRET, cb)).toBe(true);
    });
  });

  describe("Outcome mapping", () => {
    const mapOutcome = (raw: string): string => {
      switch (raw) {
        case "published":
          return "PUBLISHED";
        case "exported":
          return "EXPORTED";
        case "simulated":
          return "SIMULATED";
        case "failed":
          return "FAILED";
        case "unknown":
          return "UNKNOWN";
        default:
          return "UNKNOWN";
      }
    };

    it("maps known outcomes correctly", () => {
      expect(mapOutcome("published")).toBe("PUBLISHED");
      expect(mapOutcome("exported")).toBe("EXPORTED");
      expect(mapOutcome("simulated")).toBe("SIMULATED");
      expect(mapOutcome("failed")).toBe("FAILED");
      expect(mapOutcome("unknown")).toBe("UNKNOWN");
    });

    it("maps any ambiguous/unknown provider value to UNKNOWN, never to PUBLISHED", () => {
      expect(mapOutcome("partial_success")).toBe("UNKNOWN");
      expect(mapOutcome("")).toBe("UNKNOWN");
      expect(mapOutcome("SUCCESS")).toBe("UNKNOWN"); // wrong case → unknown
    });
  });
});
