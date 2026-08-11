import { useEffect, useId, useState } from "react";
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
  readonly onDraftChange?: (draft: WeekContextDraft) => void;
  readonly showSave?: boolean;
  readonly onSave: (draft: WeekContextDraft) => Promise<void>;
  readonly retainedConflictDraft?: WeekContextDraft | null;
};

type EditableRowKeys = {
  readonly promotionTerms: readonly string[];
  readonly mustInclude: readonly string[];
  readonly mustAvoid: readonly string[];
};

function retainedConflictDraftText(draft: WeekContextDraft): string {
  const lines: string[] = [];
  lines.push(draft.promotionMode === "none" ? "Promotion: none" : `Promotion: ${draft.promotionText}`);
  if (draft.promotionMode === "owner_approved") {
    for (const term of draft.promotionTerms) lines.push(`Term: ${term}`);
    if (draft.validFromLocal) lines.push(`Valid from: ${draft.validFromLocal}`);
    if (draft.validUntilLocal) lines.push(`Valid until: ${draft.validUntilLocal}`);
  }
  for (const item of draft.mustInclude) lines.push(`Include: ${item}`);
  for (const item of draft.mustAvoid) lines.push(`Avoid: ${item}`);
  if (draft.ctaType) {
    lines.push(`CTA: ${draft.ctaType}${draft.ctaValue ? ` — ${draft.ctaValue}` : ""}`);
  }
  return lines.filter((l) => l).join("\n");
}

async function copyRetainedConflictDraft(draft: WeekContextDraft): Promise<void> {
  const text = retainedConflictDraftText(draft);
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Clipboard may be unavailable; the text is still visible for manual copy.
  }
}

export function WeekContextForm({
  initialContext = null,
  isReadonly = false,
  isFrozen = false,
  isSubmitting = false,
  onDraftChange,
  showSave = true,
  onSave,
  retainedConflictDraft = null,
}: Props) {
  const t = useTranslations("ContentCycle.context");
  const formId = useId();
  const formatError = (key: string) =>
    t(`errors.${key}` as unknown as Parameters<typeof t>[0]);

  const initialDraft = initialContext
    ? draftFromWeekContext(initialContext)
    : createEmptyWeekContextDraft();

  const [rowSequence, setRowSequence] = useState(0);

  const createRowId = (kind: string) => {
    const rowId = `${formId}-${kind}-${rowSequence}`;
    setRowSequence((previous) => previous + 1);
    return rowId;
  };

  const createRowKeys = (source: WeekContextDraft): EditableRowKeys => ({
    promotionTerms: source.promotionTerms.map(
      (_, index) => `${formId}-promotion-term-initial-${index}`,
    ),
    mustInclude: source.mustInclude.map(
      (_, index) => `${formId}-must-include-initial-${index}`,
    ),
    mustAvoid: source.mustAvoid.map(
      (_, index) => `${formId}-must-avoid-initial-${index}`,
    ),
  });

  const [draft, setDraft] = useState<WeekContextDraft>(() => initialDraft);
  const [rowKeys, setRowKeys] = useState<EditableRowKeys>(() =>
    createRowKeys(initialDraft),
  );

  const [errors, setErrors] = useState<WeekContextFormErrors>({});

  useEffect(() => {
    onDraftChange?.(draft);
  }, [draft, onDraftChange]);

  const [prevInitialContext, setPrevInitialContext] = useState(initialContext);
  let visibleRowKeys = rowKeys;
  if (initialContext !== prevInitialContext) {
    const nextDraft = initialContext
      ? draftFromWeekContext(initialContext)
      : createEmptyWeekContextDraft();
    const nextRowKeys = createRowKeys(nextDraft);
    setPrevInitialContext(initialContext);
    setDraft(nextDraft);
    setRowKeys(nextRowKeys);
    visibleRowKeys = nextRowKeys;
  }

  const disabled = isReadonly || isFrozen || isSubmitting;
  const isDefaulted = initialContext?.context_source === "system_defaulted";

  const handlePromotionModeChange = (mode: "none" | "owner_approved") => {
    const next: WeekContextDraft = {
      ...draft,
      promotionMode: mode,
    };
    setDraft(next);
    setErrors((prev) => ({ ...prev, promotionMode: undefined, ctaType: undefined }));
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
  };

  const handleAddTerm = () => {
    const rowKey = createRowId("promotion-term");
    setDraft((prev) => ({
      ...prev,
      promotionTerms: [...prev.promotionTerms, ""],
    }));
    setRowKeys((prev) => ({
      ...prev,
      promotionTerms: [...prev.promotionTerms, rowKey],
    }));
  };

  const handleRemoveTerm = (index: number) => {
    setDraft((prev) => ({
      ...prev,
      promotionTerms: prev.promotionTerms.filter((_, i) => i !== index),
    }));
    setRowKeys((prev) => ({
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
    const rowKey = createRowId("must-include");
    setDraft((prev) => ({
      ...prev,
      mustInclude: [...prev.mustInclude, ""],
    }));
    setRowKeys((prev) => ({
      ...prev,
      mustInclude: [...prev.mustInclude, rowKey],
    }));
  };

  const handleRemoveMustInclude = (index: number) => {
    setDraft((prev) => ({
      ...prev,
      mustInclude: prev.mustInclude.filter((_, i) => i !== index),
    }));
    setRowKeys((prev) => ({
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
    const rowKey = createRowId("must-avoid");
    setDraft((prev) => ({
      ...prev,
      mustAvoid: [...prev.mustAvoid, ""],
    }));
    setRowKeys((prev) => ({
      ...prev,
      mustAvoid: [...prev.mustAvoid, rowKey],
    }));
  };

  const handleRemoveMustAvoid = (index: number) => {
    setDraft((prev) => ({
      ...prev,
      mustAvoid: prev.mustAvoid.filter((_, i) => i !== index),
    }));
    setRowKeys((prev) => ({
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
      window.requestAnimationFrame(() => {
        document
          .querySelector<HTMLElement>("[data-content-context-invalid='true']")
          ?.focus();
      });
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

      {retainedConflictDraft && (
        <div
          role="alert"
          className="rounded-lg border border-warning/30 bg-warning/10 p-3.5 text-xs text-warning space-y-2"
        >
          <p className="font-bold">{t("conflictRetainedTitle")}</p>
          <p>{t("conflictRetainedBody")}</p>
          <div className="max-h-40 overflow-auto rounded-md border border-border bg-surface p-3 font-mono text-[11px] whitespace-pre-wrap text-navy">
            {retainedConflictDraftText(retainedConflictDraft)}
          </div>
          <button
            type="button"
            onClick={() => void copyRetainedConflictDraft(retainedConflictDraft)}
            className="rounded-md border border-warning/40 bg-surface px-2.5 py-1 text-[11px] font-bold text-warning hover:bg-warning/10 focus-visible:ring-2 focus-visible:ring-warning"
          >
            {t("copyRetained")}
          </button>
        </div>
      )}

      {isFrozen && !isDefaulted && (
        <div className="rounded-lg border border-border bg-background p-3 text-xs font-semibold text-muted-foreground">
          {t("frozen")}
        </div>
      )}

      {/* 1. PROMOTION FIELDSET */}
      <fieldset className="space-y-3 border-none p-0 m-0">
        <legend className="text-xs font-bold uppercase tracking-wider text-navy mb-2">
          {t("promotionLegend")}
        </legend>

        {errors.promotionMode && (
          <p id={`${formId}-promotion-mode-error`} className="text-xs font-semibold text-danger" role="alert">
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
              aria-describedby={`${formId}-no-promotion-help${errors.promotionMode ? ` ${formId}-promotion-mode-error` : ""}`}
              data-content-context-invalid={errors.promotionMode ? "true" : undefined}
              aria-label={t("noPromotion")}
              className="mt-0.5 focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2"
            />
            <div>
              <span className="block text-xs font-bold text-navy">{t("noPromotion")}</span>
              <span id={`${formId}-no-promotion-help`} className="block text-[11px] text-muted-foreground">
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
              aria-describedby={`${formId}-approved-promotion-help${errors.promotionMode ? ` ${formId}-promotion-mode-error` : ""}`}
              aria-label={t("approvedPromotion")}
              className="mt-0.5 focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2"
            />
            <div>
              <span className="block text-xs font-bold text-navy">{t("approvedPromotion")}</span>
              <span id={`${formId}-approved-promotion-help`} className="block text-[11px] text-muted-foreground">
                {t("approvedPromotionHelp")}
              </span>
            </div>
          </label>
        </div>

        {/* Conditional Promotion Fields */}
        {draft.promotionMode === "owner_approved" && (
          <div className="mt-3 space-y-3 border-s-2 border-primary/20 ps-3 ms-1 pt-1">
            {/* Offer Text */}
            <div className="space-y-1">
              <label htmlFor={`${formId}-offer`} className="block text-xs font-semibold text-navy">{t("offer")}</label>
              <textarea
                id={`${formId}-offer`}
                name="promotionText"
                autoComplete="off"
                value={draft.promotionText}
                onChange={(e) => {
                  setDraft((p) => ({ ...p, promotionText: e.target.value }));
                  setErrors((p) => ({ ...p, promotionText: undefined }));
                }}
                disabled={disabled}
                aria-invalid={Boolean(errors.promotionText)}
                aria-describedby={errors.promotionText ? `${formId}-promotion-text-error` : undefined}
                data-content-context-invalid={errors.promotionText ? "true" : undefined}
                rows={2}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs text-navy outline-none focus:border-action focus:ring-1 focus:ring-action"
              />
              {errors.promotionText && (
                <p id={`${formId}-promotion-text-error`} className="text-xs text-danger" role="alert">{formatError(errors.promotionText)}</p>
              )}
            </div>

            {/* Terms */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-navy">{t("terms")}</span>
                {!disabled && (
                  <button
                    type="button"
                    onClick={handleAddTerm}
                    className="rounded px-1 text-xs font-semibold text-primary hover:underline focus-visible:ring-2 focus-visible:ring-action"
                  >
                    + {t("addTerm")}
                  </button>
                )}
              </div>

              {draft.promotionTerms.map((term, idx) => {
                const rowKey = visibleRowKeys.promotionTerms[idx]!;
                return (
                <div key={rowKey} className="flex items-center gap-2">
                  <input
                    id={`${rowKey}-input`}
                    name={rowKey}
                    type="text"
                    autoComplete="off"
                    aria-label={t("termInputLabel", { index: idx + 1 })}
                    value={term}
                    onChange={(e) => handleUpdateTerm(idx, e.target.value)}
                    disabled={disabled}
                    className="flex-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-navy outline-none focus:border-action focus:ring-1 focus:ring-action"
                  />
                  {!disabled && (
                    <button
                      type="button"
                      aria-label={`${t("removeTerm")} ${idx + 1}`}
                      onClick={() => handleRemoveTerm(idx)}
                      className="rounded px-1 text-xs font-bold text-danger hover:underline focus-visible:ring-2 focus-visible:ring-danger"
                    >
                      ✕
                    </button>
                  )}
                </div>
                );
              })}
            </div>

            {/* Valid From & Until */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <label htmlFor={`${formId}-valid-from`} className="block text-xs font-semibold text-navy">{t("validFrom")}</label>
                <input
                  id={`${formId}-valid-from`}
                  name="validFrom"
                  type="datetime-local"
                  autoComplete="off"
                  value={draft.validFromLocal}
                  onChange={(e) => {
                    setDraft((p) => ({ ...p, validFromLocal: e.target.value }));
                    setErrors((p) => ({ ...p, validFromLocal: undefined }));
                  }}
                  disabled={disabled}
                  aria-invalid={Boolean(errors.validFromLocal)}
                  aria-describedby={errors.validFromLocal ? `${formId}-valid-from-error` : undefined}
                  data-content-context-invalid={errors.validFromLocal ? "true" : undefined}
                  className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-navy outline-none focus:border-action focus:ring-1 focus:ring-action"
                />
                {errors.validFromLocal && (
                  <p id={`${formId}-valid-from-error`} className="text-xs text-danger" role="alert">{formatError(errors.validFromLocal)}</p>
                )}
              </div>

              <div className="space-y-1">
                <label htmlFor={`${formId}-valid-until`} className="block text-xs font-semibold text-navy">{t("validUntil")}</label>
                <input
                  id={`${formId}-valid-until`}
                  name="validUntil"
                  type="datetime-local"
                  autoComplete="off"
                  value={draft.validUntilLocal}
                  onChange={(e) => {
                    setDraft((p) => ({ ...p, validUntilLocal: e.target.value }));
                    setErrors((p) => ({ ...p, validUntilLocal: undefined }));
                  }}
                  disabled={disabled}
                  aria-invalid={Boolean(errors.validUntilLocal)}
                  aria-describedby={errors.validUntilLocal ? `${formId}-valid-until-error` : undefined}
                  data-content-context-invalid={errors.validUntilLocal ? "true" : undefined}
                  className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-navy outline-none focus:border-action focus:ring-1 focus:ring-action"
                />
                {errors.validUntilLocal && (
                  <p id={`${formId}-valid-until-error`} className="text-xs text-danger" role="alert">{formatError(errors.validUntilLocal)}</p>
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
            <span className="text-xs font-bold text-navy">{t("mustInclude")}</span>
            {!disabled && (
              <button
                type="button"
                onClick={handleAddMustInclude}
                className="rounded px-1 text-xs font-semibold text-primary hover:underline focus-visible:ring-2 focus-visible:ring-action"
              >
                + {t("addInstruction")}
              </button>
            )}
          </div>
          {draft.mustInclude.map((item, idx) => {
            const rowKey = visibleRowKeys.mustInclude[idx]!;
            return (
            <div key={rowKey} className="flex items-center gap-2">
              <input
                id={`${rowKey}-input`}
                name={rowKey}
                type="text"
                autoComplete="off"
                aria-label={t("instructionInputLabel", { kind: t("mustInclude"), index: idx + 1 })}
                value={item}
                onChange={(e) => handleUpdateMustInclude(idx, e.target.value)}
                disabled={disabled}
                className="flex-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-navy outline-none focus:border-action focus:ring-1 focus:ring-action"
              />
              {!disabled && (
                <button
                  type="button"
                  aria-label={`${t("removeInstruction")} ${idx + 1}`}
                  onClick={() => handleRemoveMustInclude(idx)}
                  className="rounded px-1 text-xs font-bold text-danger hover:underline focus-visible:ring-2 focus-visible:ring-danger"
                >
                  ✕
                </button>
              )}
            </div>
            );
          })}
        </div>

        {/* Must Avoid */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-navy">{t("mustAvoid")}</span>
            {!disabled && (
              <button
                type="button"
                onClick={handleAddMustAvoid}
                className="rounded px-1 text-xs font-semibold text-primary hover:underline focus-visible:ring-2 focus-visible:ring-action"
              >
                + {t("addInstruction")}
              </button>
            )}
          </div>
          {draft.mustAvoid.map((item, idx) => {
            const rowKey = visibleRowKeys.mustAvoid[idx]!;
            return (
            <div key={rowKey} className="flex items-center gap-2">
              <input
                id={`${rowKey}-input`}
                name={rowKey}
                type="text"
                autoComplete="off"
                aria-label={t("instructionInputLabel", { kind: t("mustAvoid"), index: idx + 1 })}
                value={item}
                onChange={(e) => handleUpdateMustAvoid(idx, e.target.value)}
                disabled={disabled}
                className="flex-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-navy outline-none focus:border-action focus:ring-1 focus:ring-action"
              />
              {!disabled && (
                <button
                  type="button"
                  aria-label={`${t("removeInstruction")} ${idx + 1}`}
                  onClick={() => handleRemoveMustAvoid(idx)}
                  className="rounded px-1 text-xs font-bold text-danger hover:underline focus-visible:ring-2 focus-visible:ring-danger"
                >
                  ✕
                </button>
              )}
            </div>
            );
          })}
        </div>
      </div>

      {/* 3. CTA FIELDSET */}
      <fieldset className="space-y-3 pt-3 border-t border-border p-0 m-0">
        <legend className="text-xs font-bold uppercase tracking-wider text-navy mb-2">
          {t("ctaLegend")}
        </legend>

        {errors.ctaType && (
          <p id={`${formId}-cta-type-error`} className="text-xs font-semibold text-danger" role="alert">
            {formatError(errors.ctaType)}
          </p>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label htmlFor={`${formId}-cta-type`} className="block text-xs font-semibold text-navy">{t("ctaType")}</label>
            <select
              id={`${formId}-cta-type`}
              name="ctaType"
              autoComplete="off"
              value={draft.ctaType ?? ""}
              onChange={(e) =>
                handleCtaTypeChange(
                  e.target.value as "none" | "phone" | "whatsapp" | "website" | "address",
                )
              }
              disabled={disabled}
              aria-invalid={Boolean(errors.ctaType)}
              aria-describedby={errors.ctaType ? `${formId}-cta-type-error` : undefined}
              data-content-context-invalid={errors.ctaType ? "true" : undefined}
              className="w-full rounded-md border border-border bg-background px-2.5 py-2 text-xs text-navy outline-none focus:border-action focus:ring-1 focus:ring-action"
            >
              <option value="">{t("selectCta")}</option>
              <option value="none">{t("ctaTypes.none")}</option>
              <option value="phone">{t("ctaTypes.phone")}</option>
              <option value="whatsapp">{t("ctaTypes.whatsapp")}</option>
              <option value="website">{t("ctaTypes.website")}</option>
              <option value="address">{t("ctaTypes.address")}</option>
            </select>
          </div>

          {draft.ctaType && draft.ctaType !== "none" && (
            <div className="space-y-1">
              <label htmlFor={`${formId}-cta-value`} className="block text-xs font-semibold text-navy">{t("ctaValue")}</label>
              <input
                id={`${formId}-cta-value`}
                name="ctaValue"
                type={draft.ctaType === "phone" ? "tel" : draft.ctaType === "website" ? "url" : "text"}
                inputMode={draft.ctaType === "phone" ? "tel" : draft.ctaType === "website" ? "url" : undefined}
                autoComplete="off"
                spellCheck={draft.ctaType !== "phone" && draft.ctaType !== "website"}
                value={draft.ctaValue}
                onChange={(e) => {
                  setDraft((p) => ({ ...p, ctaValue: e.target.value }));
                  setErrors((p) => ({ ...p, ctaValue: undefined }));
                }}
                disabled={disabled}
                aria-invalid={Boolean(errors.ctaValue)}
                aria-describedby={errors.ctaValue ? `${formId}-cta-value-error` : undefined}
                data-content-context-invalid={errors.ctaValue ? "true" : undefined}
                className="w-full rounded-md border border-border bg-background px-2.5 py-2 text-xs text-navy outline-none focus:border-action focus:ring-1 focus:ring-action"
              />
              {errors.ctaValue && (
                <p id={`${formId}-cta-value-error`} className="text-xs text-danger" role="alert">{formatError(errors.ctaValue)}</p>
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
      {showSave && !isReadonly && !isFrozen && (
        <div className="pt-3">
          <button
            type="submit"
            disabled={disabled}
            className="w-full rounded-lg bg-primary px-4 py-2.5 text-xs font-bold text-white transition-colors hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-action disabled:opacity-50"
          >
            {isSubmitting ? t("saving") : t("save")}
          </button>
        </div>
      )}
    </form>
  );
}
