import { describe, expect, it } from "vitest";
import type { ApiError } from "@/lib/api/discovery";
import { getApiErrorTranslationKey } from "../api-error-localization";

describe("getApiErrorTranslationKey", () => {
  it("keeps unreachable media origins actionable", () => {
    const error: ApiError = {
      status: 422,
      code: "PUBLISHING_MEDIA_ORIGIN_NOT_REACHABLE",
      message: "media origin is not publicly reachable",
    };

    expect(getApiErrorTranslationKey(error)).toBe(
      "Errors.mediaOriginNotReachable",
    );
  });
});
