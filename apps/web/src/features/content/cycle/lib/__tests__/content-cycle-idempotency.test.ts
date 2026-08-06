import { describe, expect, it, beforeEach } from "vitest";
import {
  computeFingerprint,
  generateUUID,
  getOrCreateIdempotencyKey,
  clearIdempotencyKey,
} from "../content-cycle-idempotency";

describe("content-cycle-idempotency", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("generateUUID produces valid UUID format", () => {
    const uuid = generateUUID();
    expect(uuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it("computeFingerprint produces reproducible hash", async () => {
    const fp1 = await computeFingerprint("test-payload-data");
    const fp2 = await computeFingerprint("test-payload-data");
    const fp3 = await computeFingerprint("different-data");

    expect(fp1).toBe(fp2);
    expect(fp1).not.toBe(fp3);
  });

  it("getOrCreateIdempotencyKey retains same key for matching scope and fingerprint", () => {
    const scope = "create:strat-1";
    const fp = "fp-100";

    const key1 = getOrCreateIdempotencyKey(scope, fp);
    const key2 = getOrCreateIdempotencyKey(scope, fp);

    expect(key1).toBe(key2);
  });

  it("getOrCreateIdempotencyKey creates new key if fingerprint changes", () => {
    const scope = "create:strat-1";

    const key1 = getOrCreateIdempotencyKey(scope, "fp-100");
    const key2 = getOrCreateIdempotencyKey(scope, "fp-200");

    expect(key1).not.toBe(key2);
  });

  it("clearIdempotencyKey removes stored key", () => {
    const scope = "generate:cycle-1:week-2";
    const fp = "fp-300";

    const key1 = getOrCreateIdempotencyKey(scope, fp);
    clearIdempotencyKey(scope);
    const key2 = getOrCreateIdempotencyKey(scope, fp);

    expect(key1).not.toBe(key2);
  });
});
