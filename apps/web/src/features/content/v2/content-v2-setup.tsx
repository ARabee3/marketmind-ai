"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type {
  ContentCtaLibraryEntryV2,
  ContentEditorialProfileV2,
  ContentMediaLibraryEntryV2,
} from "@marketmind/contracts";
import {
  createCtaEntryV2,
  deactivateCtaEntryV2,
  listCtaEntriesV2,
  listMediaV2,
  revokeMediaV2,
  resetEditorialProfileV2,
  uploadMediaV2,
  upsertEditorialProfileV2,
} from "@/lib/api/content-v2";

const CTA_TYPES = ["phone", "whatsapp", "website", "address", "none"] as const;

type SetupProps = {
  readonly cycleId: string;
  readonly editorialProfile: ContentEditorialProfileV2 | null;
  readonly ctaEntries: readonly ContentCtaLibraryEntryV2[];
  readonly mediaEntries: readonly ContentMediaLibraryEntryV2[];
  readonly onBack: () => void;
  readonly onSaved: () => void | Promise<void>;
};

export function ContentV2Setup({
  cycleId,
  editorialProfile,
  ctaEntries,
  mediaEntries,
  onBack,
  onSaved,
}: SetupProps) {
  const t = useTranslations("ContentV2.setup");
  const tErrors = useTranslations("ContentV2.errors");

  const [audienceNuance, setAudienceNuance] = useState(
    editorialProfile?.audience_nuance ?? "",
  );
  const [voice, setVoice] = useState(editorialProfile?.voice ?? "");
  const [tonePreset, setTonePreset] = useState<
    | "recommended"
    | "friendly_local"
    | "clear_professional"
    | "warm_reassuring"
    | "direct_confident"
    | "custom"
  >(editorialProfile?.tone_preset ?? "recommended");
  const [lengthPreset, setLengthPreset] = useState<
    "concise" | "balanced" | "detailed"
  >(editorialProfile?.length_preset ?? "balanced");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [language, setLanguage] = useState<"ar-EG" | "en" | "mixed">(
    editorialProfile?.language ?? "ar-EG",
  );
  const [guardrails, setGuardrails] = useState<string[]>(
    editorialProfile ? [...editorialProfile.writing_guardrails] : [""],
  );
  const [visualGuidance, setVisualGuidance] = useState(
    editorialProfile?.default_visual_guidance ?? "",
  );

  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [profileNotice, setProfileNotice] = useState<
    "saved" | "restored" | null
  >(null);
  const [saveError, setSaveError] = useState<"saveFailed" | null>(null);

  const [ctas, setCtas] =
    useState<readonly ContentCtaLibraryEntryV2[]>(ctaEntries);
  const [newCtaLabel, setNewCtaLabel] = useState("");
  const [newCtaType, setNewCtaType] =
    useState<(typeof CTA_TYPES)[number]>("whatsapp");
  const [newCtaValue, setNewCtaValue] = useState("");
  const [newCtaContext, setNewCtaContext] = useState("");
  const [isAddingCta, setIsAddingCta] = useState(false);

  const [media, setMedia] =
    useState<readonly ContentMediaLibraryEntryV2[]>(mediaEntries);
  const [isUploading, setIsUploading] = useState(false);
  const [optionalToolsOpen, setOptionalToolsOpen] = useState(
    ctaEntries.length > 0 || mediaEntries.length > 0,
  );

  const handleSaveProfile = async () => {
    setIsSavingProfile(true);
    setSaveError(null);
    setProfileNotice(null);
    try {
      await upsertEditorialProfileV2(cycleId, {
        audience_nuance: audienceNuance,
        voice,
        language,
        writing_guardrails: guardrails.filter((g) => g.trim().length > 0),
        default_visual_guidance: visualGuidance.trim() || null,
        tone_preset: tonePreset,
        length_preset: lengthPreset,
      });
      setProfileNotice("saved");
      await onSaved();
    } catch {
      setSaveError("saveFailed");
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handleRestoreRecommended = async () => {
    if (isSavingProfile) return;
    setIsSavingProfile(true);
    setSaveError(null);
    setProfileNotice(null);
    try {
      await resetEditorialProfileV2(cycleId);
      setAudienceNuance("");
      setVoice("");
      setTonePreset("recommended");
      setLengthPreset("balanced");
      setLanguage("ar-EG");
      setGuardrails([""]);
      setVisualGuidance("");
      setShowAdvanced(false);
      setProfileNotice("restored");
      await onSaved();
    } catch {
      setSaveError("saveFailed");
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handleAddCta = async () => {
    if (
      !newCtaLabel.trim() ||
      (newCtaType !== "none" && !newCtaValue.trim()) ||
      isAddingCta
    )
      return;
    setIsAddingCta(true);
    setSaveError(null);
    try {
      const { entry } = await createCtaEntryV2(cycleId, {
        label: newCtaLabel.trim(),
        destination: {
          type: newCtaType,
          value: newCtaType === "none" ? null : newCtaValue.trim() || null,
        },
        campaign_context: newCtaContext.trim() || null,
        active: true,
      });
      setCtas((current) => [...current, entry]);
      setNewCtaLabel("");
      setNewCtaValue("");
      setNewCtaContext("");
      await onSaved();
    } catch {
      setSaveError("saveFailed");
    } finally {
      setIsAddingCta(false);
    }
  };

  const handleDeactivateCta = async (entryId: string) => {
    try {
      await deactivateCtaEntryV2(cycleId, entryId);
      const { entries } = await listCtaEntriesV2(cycleId);
      setCtas(entries);
      await onSaved();
    } catch {
      setSaveError("saveFailed");
    }
  };

  const handleUpload = async (file: File) => {
    if (isUploading) return;
    setIsUploading(true);
    setSaveError(null);
    try {
      await uploadMediaV2(cycleId, file);
      const { entries } = await listMediaV2(cycleId);
      setMedia(entries);
      await onSaved();
    } catch {
      setSaveError("saveFailed");
    } finally {
      setIsUploading(false);
    }
  };

  const handleRevokeMedia = async (mediaId: string) => {
    try {
      await revokeMediaV2(cycleId, mediaId);
      const { entries } = await listMediaV2(cycleId);
      setMedia(entries);
      await onSaved();
    } catch {
      setSaveError("saveFailed");
    }
  };

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <button
          type="button"
          onClick={onBack}
          className="rounded-sm text-xs font-bold text-action hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action"
        >
          <span aria-hidden="true" className="inline-block rtl:-scale-x-100">
            ←
          </span>{" "}
          {t("backToStudio")}
        </button>
        <h1 className="text-xl font-bold text-navy">{t("preferencesTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("preferencesIntro")}</p>
      </header>

      {saveError && (
        <div
          role="alert"
          aria-live="polite"
          className="rounded-lg border border-danger/30 bg-danger/10 p-3.5 text-xs font-semibold text-danger"
        >
          {tErrors(saveError)}
        </div>
      )}

      {profileNotice && (
        <div
          role="status"
          className="rounded-lg border border-primary/30 bg-primary/10 p-3.5 text-xs font-semibold text-primary"
        >
          {profileNotice === "restored"
            ? t("restoredRecommended")
            : t("savedProfile")}
        </div>
      )}

      {/* Editorial profile */}
      <section aria-labelledby="profile-heading" className="space-y-3">
        <div className="space-y-1">
          <h2 id="profile-heading" className="text-sm font-bold text-navy">
            {t("profileSection")}
          </h2>
          <p className="text-xs text-muted-foreground">{t("profileHelp")}</p>
        </div>
        <div className="grid grid-cols-1 gap-4 rounded-xl border border-border bg-surface p-4 shadow-sm md:grid-cols-2">
          <div className="space-y-2 md:col-span-2">
            <div>
              <p className="text-xs font-semibold text-navy">
                {t("toneLabel")}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {t("toneHelp")}
              </p>
            </div>
            <div
              className="flex flex-wrap gap-2"
              role="radiogroup"
              aria-label={t("toneLabel")}
            >
              {(
                [
                  "recommended",
                  "friendly_local",
                  "clear_professional",
                  "warm_reassuring",
                  "direct_confident",
                  "custom",
                ] as const
              ).map((preset) => (
                <button
                  key={preset}
                  type="button"
                  role="radio"
                  aria-checked={tonePreset === preset}
                  onClick={() => {
                    setTonePreset(preset);
                    if (preset === "custom") setShowAdvanced(true);
                  }}
                  className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                    tonePreset === preset
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-navy hover:bg-muted"
                  }`}
                >
                  {t(`tonePresets.${preset}`)}
                </button>
              ))}
            </div>
          </div>
          <fieldset className="space-y-2">
            <legend className="text-xs font-semibold text-navy">
              {t("lengthLabel")}
            </legend>
            <div
              className="flex rounded-lg border border-border p-1"
              role="radiogroup"
              aria-label={t("lengthLabel")}
            >
              {(["concise", "balanced", "detailed"] as const).map((preset) => (
                <button
                  key={preset}
                  type="button"
                  role="radio"
                  aria-checked={lengthPreset === preset}
                  onClick={() => setLengthPreset(preset)}
                  className={`flex-1 rounded-md px-2 py-1.5 text-xs font-semibold ${
                    lengthPreset === preset
                      ? "bg-primary text-white"
                      : "text-navy hover:bg-muted"
                  }`}
                >
                  {t(`lengthPresets.${preset}`)}
                </button>
              ))}
            </div>
          </fieldset>
          <label className="space-y-1.5">
            <span className="text-xs font-semibold text-navy">
              {t("language")}
            </span>
            <select
              value={language}
              onChange={(event) =>
                setLanguage(event.target.value as "ar-EG" | "en" | "mixed")
              }
              name="language"
              className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-navy focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-action"
            >
              <option value="ar-EG">{t("languageOptions.ar-EG")}</option>
              <option value="en">{t("languageOptions.en")}</option>
              <option value="mixed">{t("languageOptions.mixed")}</option>
            </select>
          </label>
          <div className="md:col-span-2">
            <button
              type="button"
              onClick={() => setShowAdvanced((current) => !current)}
              className="text-xs font-bold text-action hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action"
              aria-expanded={showAdvanced}
            >
              {showAdvanced ? "−" : "+"} {t("advancedLabel")}
            </button>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {t("advancedHelp")}
            </p>
          </div>
          {showAdvanced && (
            <>
              <label className="space-y-1.5">
                <span className="text-xs font-semibold text-navy">
                  {t("audienceNuance")}
                </span>
                <textarea
                  dir="auto"
                  value={audienceNuance}
                  onChange={(event) => setAudienceNuance(event.target.value)}
                  placeholder={t("audienceNuancePlaceholder")}
                  rows={3}
                  name="audience-nuance"
                  className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-navy placeholder:text-muted-foreground focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-action"
                />
              </label>
              <label className="space-y-1.5">
                <span className="text-xs font-semibold text-navy">
                  {t("voice")}
                </span>
                <textarea
                  dir="auto"
                  value={voice}
                  onChange={(event) => setVoice(event.target.value)}
                  placeholder={t("voicePlaceholder")}
                  rows={3}
                  name="editorial-voice"
                  className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-navy placeholder:text-muted-foreground focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-action"
                />
              </label>
              <label className="space-y-1.5">
                <span className="text-xs font-semibold text-navy">
                  {t("visualGuidance")}
                </span>
                <textarea
                  dir="auto"
                  value={visualGuidance}
                  onChange={(event) => setVisualGuidance(event.target.value)}
                  placeholder={t("visualGuidancePlaceholder")}
                  rows={3}
                  name="visual-guidance"
                  className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-navy placeholder:text-muted-foreground focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-action"
                />
              </label>
              <div className="space-y-1.5 md:col-span-2">
                <span className="text-xs font-semibold text-navy">
                  {t("guardrails")}
                </span>
                {guardrails.map((guardrail, index) => (
                  <div key={index} className="flex gap-2">
                    <input
                      dir="auto"
                      type="text"
                      value={guardrail}
                      onChange={(event) =>
                        setGuardrails((current) =>
                          current.map((value, i) =>
                            i === index ? event.target.value : value,
                          ),
                        )
                      }
                      name={`guardrail-${index + 1}`}
                      className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-navy focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-action"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setGuardrails((current) =>
                          current.filter((_, i) => i !== index),
                        )
                      }
                      aria-label={t("removeGuardrail")}
                      className="rounded-lg border border-border px-3 text-xs font-bold text-danger hover:bg-danger/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action"
                    >
                      ×
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setGuardrails((current) => [...current, ""])}
                  className="rounded-sm text-xs font-bold text-action hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action"
                >
                  + {t("guardrailsAdd")}
                </button>
              </div>
            </>
          )}
          <div className="md:col-span-2">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void handleSaveProfile()}
                disabled={isSavingProfile}
                className="rounded-lg bg-primary px-4 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action disabled:opacity-60"
              >
                {isSavingProfile
                  ? t("savingPreferences")
                  : t("savePreferences")}
              </button>
              <button
                type="button"
                onClick={() => void handleRestoreRecommended()}
                disabled={isSavingProfile}
                className="rounded-lg border border-border px-4 py-2.5 text-xs font-bold text-navy hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action disabled:opacity-60"
              >
                {t("restoreRecommended")}
              </button>
            </div>
          </div>
        </div>
      </section>

      <details
        className="rounded-xl border border-border bg-surface p-4 shadow-sm"
        open={optionalToolsOpen}
        onToggle={(event) => setOptionalToolsOpen(event.currentTarget.open)}
      >
        <summary className="cursor-pointer list-none space-y-1 text-sm font-bold text-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action">
          <span className="block">{t("optionalToolsTitle")}</span>
          <span className="block text-xs font-normal text-muted-foreground">
            {t("optionalToolsHelp")}
          </span>
        </summary>
        <div className="mt-5 space-y-6">
          {/* CTA library */}
          <section aria-labelledby="cta-heading" className="space-y-3">
            <div className="space-y-1">
              <h2 id="cta-heading" className="text-sm font-bold text-navy">
                {t("ctaSection")}
              </h2>
              <p className="text-xs text-muted-foreground">{t("ctaHelp")}</p>
            </div>
            <div className="space-y-3 rounded-xl border border-border bg-surface p-4 shadow-sm">
              {ctas.length === 0 ? (
                <p className="text-xs text-muted-foreground">{t("noCtas")}</p>
              ) : (
                <ul className="space-y-2">
                  {ctas.map((entry) => (
                    <li
                      key={entry.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border px-3 py-2"
                    >
                      <div className="space-y-0.5">
                        <p className="text-xs font-bold text-navy">
                          {entry.label}
                          {!entry.active && (
                            <span className="ms-2 text-[11px] font-semibold text-muted-foreground">
                              ({t("inactiveCta")})
                            </span>
                          )}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {t(`destinationTypes.${entry.destination.type}`)}
                          {entry.destination.value
                            ? ` · ${entry.destination.value}`
                            : ""}
                        </p>
                      </div>
                      {entry.active && (
                        <button
                          type="button"
                          onClick={() => void handleDeactivateCta(entry.id)}
                          className="rounded-lg border border-border px-3 py-1 text-[11px] font-bold text-danger hover:bg-danger/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger"
                        >
                          {t("deactivateCta")}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_10rem_1fr_1fr_auto]">
                <label className="space-y-1">
                  <span className="text-[11px] font-semibold text-muted-foreground">
                    {t("ctaLabel")}
                  </span>
                  <input
                    type="text"
                    value={newCtaLabel}
                    onChange={(event) => setNewCtaLabel(event.target.value)}
                    name="cta-label"
                    className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-navy focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-action"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[11px] font-semibold text-muted-foreground">
                    {t("ctaDestinationType")}
                  </span>
                  <select
                    value={newCtaType}
                    onChange={(event) =>
                      setNewCtaType(
                        event.target.value as (typeof CTA_TYPES)[number],
                      )
                    }
                    name="cta-destination-type"
                    className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-navy focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-action"
                  >
                    {CTA_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {t(`destinationTypes.${type}`)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="text-[11px] font-semibold text-muted-foreground">
                    {t("ctaDestinationValue")}
                  </span>
                  <input
                    type="text"
                    value={newCtaValue}
                    onChange={(event) => setNewCtaValue(event.target.value)}
                    name="cta-destination-value"
                    required={newCtaType !== "none"}
                    className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-navy focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-action"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[11px] font-semibold text-muted-foreground">
                    {t("ctaContext")}
                  </span>
                  <input
                    type="text"
                    value={newCtaContext}
                    onChange={(event) => setNewCtaContext(event.target.value)}
                    name="cta-context"
                    className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-navy focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-action"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => void handleAddCta()}
                  disabled={
                    isAddingCta ||
                    !newCtaLabel.trim() ||
                    (newCtaType !== "none" && !newCtaValue.trim())
                  }
                  className="self-end rounded-lg bg-action px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-action/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action disabled:opacity-60"
                >
                  {t("addCta")}
                </button>
              </div>
            </div>
          </section>

          {/* Media library */}
          <section aria-labelledby="media-heading" className="space-y-3">
            <div className="space-y-1">
              <h2 id="media-heading" className="text-sm font-bold text-navy">
                {t("mediaSection")}
              </h2>
              <p className="text-xs text-muted-foreground">{t("mediaHelp")}</p>
            </div>
            <div className="space-y-3 rounded-xl border border-border bg-surface p-4 shadow-sm">
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-primary/90 focus-within:outline-none focus-within:ring-2 focus-within:ring-action">
                {isUploading ? t("uploadingMedia") : t("uploadMedia")}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="sr-only"
                  disabled={isUploading}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void handleUpload(file);
                    event.target.value = "";
                  }}
                />
              </label>
              {media.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  {t("mediaEmpty")}
                </p>
              ) : (
                <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
                  {media.map((entry) => (
                    <li
                      key={entry.id}
                      className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2"
                    >
                      <div className="min-w-0 space-y-0.5">
                        <p className="truncate text-[11px] font-bold text-navy">
                          {entry.kind === "generated_static"
                            ? t("generatedMedia")
                            : entry.mime_type}
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          {entry.width && entry.height
                            ? `${entry.width}×${entry.height}`
                            : ""}
                        </p>
                      </div>
                      {entry.status === "ready" && (
                        <button
                          type="button"
                          onClick={() => void handleRevokeMedia(entry.id)}
                          aria-label={t("revokeMedia")}
                          className="text-[11px] font-bold text-danger hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action"
                        >
                          ×
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </div>
      </details>
    </div>
  );
}
