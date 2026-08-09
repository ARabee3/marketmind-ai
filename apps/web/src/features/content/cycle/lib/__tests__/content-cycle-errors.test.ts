import { describe, expect, it } from "vitest";
import { contentErrorKey } from "../content-cycle-errors";

describe("contentErrorKey", () => {
  it("maps explicit backend error codes to translation keys", () => {
    expect(contentErrorKey({ code: "CONTENT_STRATEGY_NOT_APPROVED" })).toBe("strategyNotApproved");
    expect(contentErrorKey({ code: "CONTENT_PROFILE_STALE" })).toBe("profileStale");
    expect(contentErrorKey({ code: "CONTENT_CYCLE_PAUSED" })).toBe("cyclePaused");
    expect(contentErrorKey({ code: "CONTENT_CYCLE_COMPLETED" })).toBe("cycleCompleted");
    expect(contentErrorKey({ code: "CONTENT_WEEK_OUT_OF_RANGE" })).toBe("weekOutOfRange");
    expect(contentErrorKey({ code: "CONTENT_WEEK_ALREADY_CLAIMED" })).toBe("weekAlreadyClaimed");
    expect(contentErrorKey({ code: "CONTENT_PROVIDER_FAILURE" })).toBe("providerFailure");
    expect(contentErrorKey({ code: "CONTENT_PACK_NOT_FAILED" })).toBe("packNotFailed");
    expect(contentErrorKey({ code: "CONTENT_RETRY_NOT_ALLOWED" })).toBe("retryNotAllowed");
    expect(contentErrorKey({ code: "CONTENT_PACK_RETRY_CONFLICT" })).toBe("retryConflict");
    expect(contentErrorKey({ code: "CONTENT_V2_REQUIRED" })).toBe("contentV2Required");
  });

  it("maps HTTP status codes when no explicit business code is present", () => {
    expect(contentErrorKey({ status: 400 })).toBe("badRequest");
    expect(contentErrorKey({ status: 401 })).toBe("unauthorized");
    expect(contentErrorKey({ status: 403 })).toBe("forbidden");
    expect(contentErrorKey({ status: 404 })).toBe("notFound");
    expect(contentErrorKey({ status: 409 })).toBe("conflict");
    expect(contentErrorKey({ status: 429 })).toBe("rateLimited");
    expect(contentErrorKey({ status: 500 })).toBe("unavailable");
    expect(contentErrorKey({ status: 503 })).toBe("unavailable");
  });

  it("prioritizes specific code mapping over status mapping", () => {
    expect(
      contentErrorKey({ status: 409, code: "CONTENT_WEEK_ALREADY_CLAIMED" }),
    ).toBe("weekAlreadyClaimed");
  });

  it("returns unknown for unhandled errors", () => {
    expect(contentErrorKey(null)).toBe("unknown");
    expect(contentErrorKey({})).toBe("unknown");
    expect(contentErrorKey({ status: 418 })).toBe("unknown");
  });
});
