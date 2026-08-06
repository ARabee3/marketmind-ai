import { useState } from "react";
import { useTranslations } from "next-intl";
import type { ContentWeekContext } from "@marketmind/contracts";
import {
  type WeekContextDraft,
  type WeekContextFormErrors,
  createEmptyWeekContextDraft,
  draftFromWeekContext,
  validateWeekContextDraft,
} from "../lib/content-cycle-form";

type Props = {
  readonly initialContext?: ContentWeekContext | null;
  readonly isReadonly?: boolean;
  readonly isFrozen?: boolean;
  readonly isSubmitting?: boolean;
  readonly onSave: (draft: WeekContextDraft) => Promise<void>;
};

export function WeekContextForm({
  initialContext = null,
  isReadonly = false,
  isFrozen = false,
  isSubmitting = false,
  onSave,
}: Props) {
  const t = useTranslations("ContentCycle.context");
  const formatError = (key: string) =>
    t(`errors.${key}` as unknown as Parameters<typeof t>[0]);

  const [draft, setDraft] = useState<WeekContextDraft>(() =>
    initialContext
      ? draftFromWeekContext(initialContext)
      : createEmptyWeekContextDraft(),
  );

  const [errors, setErrors] = useState<WeekContextFormErrors>({});

  const [prevInitialContext, setPrevInitialContext] = useState(initialContext);
  if (initialContext !== prevInitialContext) {
    setPrevInitialContext(initialContext);
    setDraft(
      initialContext
        ? draftFromWeekContext(initialContext)
        : createEmptyWeekContextDraft(),
    );
  }

  const disabled = isReadonly || isFrozen || isSubmitting;
  const isDefaulted = initialContext?.context_source === "system_defaulted";

  const handlePromotionModeChange = (mode: "none" | "owner_approved") => {
    const next: WeekContextDraft = {
      ...draft,
      promotionMode: mode,
      ctaType: draft.ctaType ?? "none",
    };
    setDraft(next);
    setErrors((prev) => ({ ...prev, promotionMode: undefined, ctaType: undefined }));
    void onSave(next);
  };

  const handleCtaTypeChange = (
    type: "none" | "phone" | "whatsapp" | "website" | "address",
  ) => {
    const next = {
      ...draft,
      ctaType: type,
      ctaValue: type === "none" ? "" : draft.ctaValue,
    };
    setDraft(next);
    setErrors((prev) => ({ ...prev, ctaType: undefined, ctaValue: undefined }));
    void onSave(next);
  };

  const handleAddTerm = () => {
    setDraft((prev) => ({
      ...prev,
      promotionTerms: [...prev.promotionTerms, ""],
    }));
  };

  const handleRemoveTerm = (index: number) => {
    setDraft((prev) => ({
      ...prev,
      promotionTerms: prev.promotionTerms.filter((_, i) => i !== index),
    }));
  };

  const handleUpdateTerm = (index: number, value: string) => {
    setDraft((prev) => {
      const terms = [...prev.promotionTerms];
      terms[index] = value;
      return { ...prev, promotionTerms: terms };
    });
  };

  const handleAddMustInclude = () => {
    setDraft((prev) => ({
      ...prev,
      mustInclude: [...prev.mustInclude, ""],
    }));
  };

  const handleRemoveMustInclude = (index: number) => {
    setDraft((prev) => ({
      ...prev,
      mustInclude: prev.mustInclude.filter((_, i) => i !== index),
    }));
  };

  const handleUpdateMustInclude = (index: number, value: string) => {
    setDraft((prev) => {
      const list = [...prev.mustInclude];
      list[index] = value;
      return { ...prev, mustInclude: list };
    });
  };

  const handleAddMustAvoid = () => {
    setDraft((prev) => ({
      ...prev,
      mustAvoid: [...prev.mustAvoid, ""],
    }));
  };

  const handleRemoveMustAvoid = (index: number) => {
    setDraft((prev) => ({
      ...prev,
      mustAvoid: prev.mustAvoid.filter((_, i) => i !== index),
    }));
  };

  const handleUpdateMustAvoid = (index: number, value: string) => {
    setDraft((prev) => {
      const list = [...prev.mustAvoid];
      list[index] = value;
      return { ...prev, mustAvoid: list };
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (disabled) return;

    const validation = validateWeekContextDraft(draft);
    if (!validation.isValid) {
      setErrors(validation.errors);
      return;
    }

    setErrors({});
    await onSave(draft);
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-xl border border-border bg-surface p-5 space-y-6 shadow-sm"
    >
      <div className="border-b border-border pb-3">
        <h2 className="text-base font-bold text-navy">{t("title")}</h2>
        <p className="text-xs text-muted-foreground">{t("body")}</p>
      </div>

      {isDefaulted && (
        <div className="rounded-lg border border-warning/30 bg-warning/10 p-3.5 text-xs text-warning space-y-1">
          <p className="font-bold">{t("safeDefaultTitle")}</p>
          <p>{t("safeDefaultBody")}</p>
        </div>
      )}

      {isFrozen && !isDefaulted && (
        <div className="rounded-lg border border-border bg-background p-3 text-xs font-semibold text-muted-foreground">
          🔒 {t("frozen")}
        </div>
      )}

      {/* 1. PROMOTION FIELDSET */}
      <fieldset className="space-y-3 border-none p-0 m-0">
        <legend className="text-xs font-bold uppercase tracking-wider text-navy mb-2">
          {t("promotionLegend")}
        </legend>

        {errors.promotionMode && (
          <p className="text-xs font-semibold text-danger" role="alert">
            {formatError(errors.promotionMode)}
          </p>
        )}

        <div className="space-y-2">
          <label className="flex items-start gap-2.5 rounded-lg border border-border p-3 cursor-pointer hover:bg-background">
            <input
              type="radio"
              name="promotionMode"
              value="none"
              checked={draft.promotionMode === "none"}
              onChange={() => handlePromotionModeChange("none")}
              disabled={disabled}
              className="mt-0.5"
            />
            <div>
              <span className="block text-xs font-bold text-navy">{t("noPromotion")}</span>
              <span className="block text-[11px] text-muted-foreground">
                {t("noPromotionHelp")}
              </span>
            </div>
          </label>

          <label className="flex items-start gap-2.5 rounded-lg border border-border p-3 cursor-pointer hover:bg-background">
            <input
              type="radio"
              name="promotionMode"
              value="owner_approved"
              checked={draft.promotionMode === "owner_approved"}
              onChange={() => handlePromotionModeChange("owner_approved")}
              disabled={disabled}
              className="mt-0.5"
            />
            <div>
              <span className="block text-xs font-bold text-navy">{t("approvedPromotion")}</span>
              <span className="block text-[11px] text-muted-foreground">
                {t("approvedPromotionHelp")}
              </span>
            </div>
          </label>
        </div>

        {/* Conditional Promotion Fields */}
        {draft.promotionMode === "owner_approved" && (
          <div className="mt-3 space-y-3 border-s-2 border-action/40 ps-3 ms-1 pt-1">
            {/* Offer Text */}
            <div className="space-y-1">
              <label className="block text-xs font-semibold text-navy">{t("offer")}</label>
              <textarea
                value={draft.promotionText}
                onChange={(e) => {
                  setDraft((p) => ({ ...p, promotionText: e.target.value }));
                  setErrors((p) => ({ ...p, promotionText: undefined }));
                }}
                disabled={disabled}
                rows={2}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs text-navy outline-none focus:border-action focus:ring-1 focus:ring-action"
              />
              {errors.promotionText && (
                <p className="text-xs text-danger">{formatError(errors.promotionText)}</p>
              )}
            </div>

            {/* Terms */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-navy">{t("terms")}</label>
                {!disabled && (
                  <button
                    type="button"
                    onClick={handleAddTerm}
                    className="text-xs font-semibold text-action hover:underline"
                  >
                    + {t("addTerm")}
                  </button>
                )}
              </div>

              {draft.promotionTerms.map((term, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={term}
                    onChange={(e) => handleUpdateTerm(idx, e.target.value)}
                    disabled={disabled}
                    className="flex-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-navy outline-none"
                  />
                  {!disabled && (
                    <button
                      type="button"
                      aria-label={`${t("removeTerm")} ${idx + 1}`}
                      onClick={() => handleRemoveTerm(idx)}
                      className="text-xs font-bold text-danger hover:underline px-1"
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
            </div>

            {/* Valid From & Until */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <label className="block text-xs font-semibold text-navy">{t("validFrom")}</label>
                <input
                  type="datetime-local"
                  value={draft.validFromLocal}
                  onChange={(e) => {
                    setDraft((p) => ({ ...p, validFromLocal: e.target.value }));
                    setErrors((p) => ({ ...p, validFromLocal: undefined }));
                  }}
                  disabled={disabled}
                  className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-navy outline-none"
                />
                {errors.validFromLocal && (
                  <p className="text-xs text-danger">{formatError(errors.validFromLocal)}</p>
                )}
              </div>

              <div className="space-y-1">
                <label className="block text-xs font-semibold text-navy">{t("validUntil")}</label>
                <input
                  type="datetime-local"
                  value={draft.validUntilLocal}
                  onChange={(e) => {
                    setDraft((p) => ({ ...p, validUntilLocal: e.target.value }));
                    setErrors((p) => ({ ...p, validUntilLocal: undefined }));
                  }}
                  disabled={disabled}
                  className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-navy outline-none"
                />
                {errors.validUntilLocal && (
                  <p className="text-xs text-danger">{formatError(errors.validUntilLocal)}</p>
                )}
              </div>
            </div>
          </div>
        )}
      </fieldset>

      {/* 2. MUST INCLUDE / MUST AVOID */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 pt-3 border-t border-border">
        {/* Must Include */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold text-navy">{t("mustInclude")}</label>
            {!disabled && (
              <button
                type="button"
                onClick={handleAddMustInclude}
                className="text-xs font-semibold text-action hover:underline"
              >
                + {t("addInstruction")}
              </button>
            )}
          </div>
          {draft.mustInclude.map((item, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <input
                type="text"
                value={item}
                onChange={(e) => handleUpdateMustInclude(idx, e.target.value)}
                disabled={disabled}
                className="flex-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-navy outline-none"
              />
              {!disabled && (
                <button
                  type="button"
                  aria-label={`${t("removeInstruction")} ${idx + 1}`}
                  onClick={() => handleRemoveMustInclude(idx)}
                  className="text-xs font-bold text-danger hover:underline px-1"
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>

        {/* Must Avoid */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold text-navy">{t("mustAvoid")}</label>
            {!disabled && (
              <button
                type="button"
                onClick={handleAddMustAvoid}
                className="text-xs font-semibold text-action hover:underline"
              >
                + {t("addInstruction")}
              </button>
            )}
          </div>
          {draft.mustAvoid.map((item, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <input
                type="text"
                value={item}
                onChange={(e) => handleUpdateMustAvoid(idx, e.target.value)}
                disabled={disabled}
                className="flex-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-navy outline-none"
              />
              {!disabled && (
                <button
                  type="button"
                  aria-label={`${t("removeInstruction")} ${idx + 1}`}
                  onClick={() => handleRemoveMustAvoid(idx)}
                  className="text-xs font-bold text-danger hover:underline px-1"
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* 3. CTA FIELDSET */}
      <fieldset className="space-y-3 pt-3 border-t border-border p-0 m-0">
        <legend className="text-xs font-bold uppercase tracking-wider text-navy mb-2">
          {t("ctaLegend")}
        </legend>

        {errors.ctaType && (
          <p className="text-xs font-semibold text-danger" role="alert">
            {formatError(errors.ctaType)}
          </p>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label className="block text-xs font-semibold text-navy">{t("ctaType")}</label>
            <select
              value={draft.ctaType ?? "none"}
              onChange={(e) =>
                handleCtaTypeChange(
                  e.target.value as "none" | "phone" | "whatsapp" | "website" | "address",
                )
              }
              disabled={disabled}
              className="w-full rounded-md border border-border bg-background px-2.5 py-2 text-xs text-navy outline-none"
            >
              <option value="none">{t("ctaTypes.none")}</option>
              <option value="phone">{t("ctaTypes.phone")}</option>
              <option value="whatsapp">{t("ctaTypes.whatsapp")}</option>
              <option value="website">{t("ctaTypes.website")}</option>
              <option value="address">{t("ctaTypes.address")}</option>
            </select>
          </div>

          {draft.ctaType && draft.ctaType !== "none" && (
            <div className="space-y-1">
              <label className="block text-xs font-semibold text-navy">{t("ctaValue")}</label>
              <input
                type="text"
                value={draft.ctaValue}
                onChange={(e) => {
                  setDraft((p) => ({ ...p, ctaValue: e.target.value }));
                  setErrors((p) => ({ ...p, ctaValue: undefined }));
                }}
                disabled={disabled}
                className="w-full rounded-md border border-border bg-background px-2.5 py-2 text-xs text-navy outline-none"
              />
              {errors.ctaValue && (
                <p className="text-xs text-danger">{formatError(errors.ctaValue)}</p>
              )}
            </div>
          )}
        </div>
      </fieldset>

      {/* 4. APPROVED PHOTOS NOTICE */}
      <div className="pt-3 border-t border-border space-y-1.5">
        <label className="block text-xs font-bold text-navy">{t("assets")}</label>
        <div className="rounded-lg border border-border bg-background p-3 text-xs text-muted-foreground space-y-1">
          <p className="font-semibold text-navy">
            {t("retainedAssets", { count: draft.retainedAssetIds.length })}
          </p>
          <p>{t("assetCapabilityUnavailable")}</p>
        </div>
      </div>

      {/* SAVE BUTTON */}
      {!disabled && (
        <div className="pt-3">
          <button
            type="submit"
            disabled={disabled}
            className="w-full rounded-lg bg-action px-4 py-2.5 text-xs font-bold text-white transition-colors hover:bg-action/90 focus-visible:ring-2 focus-visible:ring-action disabled:opacity-50"
          >
            {isSubmitting ? t("saving") : t("save")}
          </button>
        </div>
      )}
    </form>
  );
}
