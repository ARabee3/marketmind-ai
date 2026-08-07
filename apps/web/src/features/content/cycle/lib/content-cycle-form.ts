import type {
  ContentWeekContext,
  UpdateContentWeekContextRequest,
} from "@marketmind/contracts";
import {
  cairoLocalToIsoString,
  isoToCairoLocalString,
} from "./content-cycle-schedule";

export type WeekContextDraft = {
  promotionMode: null | "none" | "owner_approved";
  promotionText: string;
  promotionTerms: readonly string[];
  validFromLocal: string;
  validUntilLocal: string;
  mustInclude: readonly string[];
  mustAvoid: readonly string[];
  ctaType: null | "none" | "phone" | "whatsapp" | "website" | "address";
  ctaValue: string;
  retainedAssetIds: readonly string[];
};

export type WeekContextFormErrors = {
  promotionMode?: string;
  promotionText?: string;
  validFromLocal?: string;
  validUntilLocal?: string;
  ctaType?: string;
  ctaValue?: string;
};

export function createEmptyWeekContextDraft(): WeekContextDraft {
  return {
    promotionMode: null,
    promotionText: "",
    promotionTerms: [],
    validFromLocal: "",
    validUntilLocal: "",
    mustInclude: [],
    mustAvoid: [],
    ctaType: null,
    ctaValue: "",
    retainedAssetIds: [],
  };
}

export function draftFromWeekContext(context: ContentWeekContext): WeekContextDraft {
  const isApproved = context.promotion_mode === "owner_approved";
  return {
    promotionMode: context.promotion_mode,
    promotionText: isApproved ? context.promotion?.text ?? "" : "",
    promotionTerms: isApproved ? context.promotion?.terms ?? [] : [],
    validFromLocal: isApproved && context.promotion?.valid_from
      ? isoToCairoLocalString(context.promotion.valid_from)
      : "",
    validUntilLocal: isApproved && context.promotion?.valid_until
      ? isoToCairoLocalString(context.promotion.valid_until)
      : "",
    mustInclude: context.must_include ?? [],
    mustAvoid: context.must_avoid ?? [],
    ctaType: context.cta_destination?.type ?? "none",
    ctaValue: context.cta_destination?.value ?? "",
    retainedAssetIds: context.approved_asset_ids ?? [],
  };
}

export function validateWeekContextDraft(
  draft: WeekContextDraft,
): { isValid: boolean; errors: WeekContextFormErrors } {
  const errors: WeekContextFormErrors = {};

  if (!draft.promotionMode) {
    errors.promotionMode = "promotionModeRequired";
  } else if (draft.promotionMode === "owner_approved") {
    if (!draft.promotionText.trim()) {
      errors.promotionText = "promotionTextRequired";
    }
    if (!draft.validFromLocal) {
      errors.validFromLocal = "validFromRequired";
    } else {
      try {
        cairoLocalToIsoString(draft.validFromLocal);
      } catch {
        errors.validFromLocal = "validFromInvalid";
      }
    }
    if (!draft.validUntilLocal) {
      errors.validUntilLocal = "validUntilRequired";
    } else {
      try {
        cairoLocalToIsoString(draft.validUntilLocal);
      } catch {
        errors.validUntilLocal = "validUntilInvalid";
      }
    }
    if (
      draft.validFromLocal &&
      draft.validUntilLocal &&
      draft.validFromLocal >= draft.validUntilLocal
    ) {
      errors.validUntilLocal = "validUntilMustBeAfterValidFrom";
    }
  }

  if (!draft.ctaType) {
    errors.ctaType = "ctaTypeRequired";
  } else if (draft.ctaType !== "none" && !draft.ctaValue.trim()) {
    errors.ctaValue = "ctaValueRequired";
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
  };
}

export function serializeWeekContext(
  draft: WeekContextDraft,
  options: {
    weekNumber: number;
    weekStartDate: string;
    retainedAssetIds?: readonly string[];
  },
): UpdateContentWeekContextRequest {
  const cleanTerms = (draft.promotionTerms ?? [])
    .map((t) => t.trim())
    .filter(Boolean);

  const cleanMustInclude = (draft.mustInclude ?? [])
    .map((i) => i.trim())
    .filter(Boolean);

  const cleanMustAvoid = (draft.mustAvoid ?? [])
    .map((a) => a.trim())
    .filter(Boolean);

  const ctaType = draft.ctaType ?? "none";
  const ctaValue = ctaType === "none" ? null : draft.ctaValue.trim();

  const assetIds = options.retainedAssetIds ?? draft.retainedAssetIds ?? [];

  if (draft.promotionMode === "owner_approved") {
    return {
      week_number: options.weekNumber,
      week_start_date: options.weekStartDate,
      promotion_mode: "owner_approved",
      promotion: {
        text: draft.promotionText.trim(),
        terms: cleanTerms,
        valid_from: cairoLocalToIsoString(draft.validFromLocal),
        valid_until: cairoLocalToIsoString(draft.validUntilLocal),
      },
      must_include: cleanMustInclude,
      must_avoid: cleanMustAvoid,
      approved_asset_ids: assetIds,
      cta_destination: {
        type: ctaType,
        value: ctaValue,
      },
    };
  }

  return {
    week_number: options.weekNumber,
    week_start_date: options.weekStartDate,
    promotion_mode: "none",
    promotion: null,
    must_include: cleanMustInclude,
    must_avoid: cleanMustAvoid,
    approved_asset_ids: assetIds,
    cta_destination: {
      type: ctaType,
      value: ctaValue,
    },
  };
}
