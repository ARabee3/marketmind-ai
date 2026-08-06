import { describe, expect, it } from "vitest";
import {
  createEmptyWeekContextDraft,
  draftFromWeekContext,
  validateWeekContextDraft,
  serializeWeekContext,
} from "../content-cycle-form";
import { mockOwnerConfirmedContextWeek1 } from "../content-cycle-fixtures";

describe("content-cycle-form", () => {
  it("createEmptyWeekContextDraft initializes unselected promotion and CTA", () => {
    const draft = createEmptyWeekContextDraft();
    expect(draft.promotionMode).toBeNull();
    expect(draft.ctaType).toBeNull();
    expect(draft.mustInclude).toEqual([]);
    expect(draft.mustAvoid).toEqual([]);
    expect(draft.retainedAssetIds).toEqual([]);
  });

  it("draftFromWeekContext populates draft from owner-confirmed context", () => {
    const draft = draftFromWeekContext(mockOwnerConfirmedContextWeek1);
    expect(draft.promotionMode).toBe("owner_approved");
    expect(draft.promotionText).toBe("Summer Refresh Special: Buy 1 Get 1 50% Off");
    expect(draft.ctaType).toBe("whatsapp");
    expect(draft.ctaValue).toBe("+201000000000");
    expect(draft.retainedAssetIds).toEqual(["asset-101", "asset-102"]);
  });

  it("validateWeekContextDraft enforces required promotionMode and ctaType", () => {
    const draft = createEmptyWeekContextDraft();
    const result = validateWeekContextDraft(draft);

    expect(result.isValid).toBe(false);
    expect(result.errors.promotionMode).toBe("promotionModeRequired");
    expect(result.errors.ctaType).toBe("ctaTypeRequired");
  });

  it("validateWeekContextDraft validates owner_approved promotion fields and date range", () => {
    const draft = {
      ...createEmptyWeekContextDraft(),
      promotionMode: "owner_approved" as const,
      promotionText: "",
      validFromLocal: "2026-08-15T12:00",
      validUntilLocal: "2026-08-10T12:00", // invalid range
      ctaType: "none" as const,
      ctaValue: "",
    };

    const result = validateWeekContextDraft(draft);
    expect(result.isValid).toBe(false);
    expect(result.errors.promotionText).toBe("promotionTextRequired");
    expect(result.errors.validUntilLocal).toBe("validUntilMustBeAfterValidFrom");
  });

  it("serializeWeekContext with promotionMode 'none' sets promotion to null and omits nested fields", () => {
    const draft = {
      ...createEmptyWeekContextDraft(),
      promotionMode: "none" as const,
      promotionText: "Should be ignored",
      validFromLocal: "2026-08-10T10:00",
      validUntilLocal: "2026-08-16T22:00",
      ctaType: "none" as const,
      ctaValue: "",
      mustInclude: ["  Item 1  ", ""],
      retainedAssetIds: ["asset-1"],
    };

    const serialized = serializeWeekContext(draft, {
      weekNumber: 1,
      weekStartDate: "2026-08-10",
    });

    expect(serialized.promotion_mode).toBe("none");
    expect(serialized.promotion).toBeNull();
    expect(serialized.must_include).toEqual(["Item 1"]);
    expect(serialized.approved_asset_ids).toEqual(["asset-1"]);
    expect(serialized.cta_destination).toEqual({ type: "none", value: null });
  });

  it("serializeWeekContext with promotionMode 'owner_approved' formats ISO dates and cleans arrays", () => {
    const draft = {
      ...createEmptyWeekContextDraft(),
      promotionMode: "owner_approved" as const,
      promotionText: "Summer offer",
      promotionTerms: [" Term 1 ", ""],
      validFromLocal: "2026-08-10T08:00",
      validUntilLocal: "2026-08-16T22:00",
      ctaType: "phone" as const,
      ctaValue: " +201234567890 ",
      mustInclude: ["Must 1"],
      mustAvoid: ["Avoid 1"],
    };

    const serialized = serializeWeekContext(draft, {
      weekNumber: 2,
      weekStartDate: "2026-08-17",
      retainedAssetIds: ["asset-99"],
    });

    expect(serialized.promotion_mode).toBe("owner_approved");
    expect(serialized.promotion?.text).toBe("Summer offer");
    expect(serialized.promotion?.terms).toEqual(["Term 1"]);
    expect(serialized.promotion?.valid_from).toContain("Z");
    expect(serialized.cta_destination).toEqual({
      type: "phone",
      value: "+201234567890",
    });
    expect(serialized.approved_asset_ids).toEqual(["asset-99"]);
  });
});
