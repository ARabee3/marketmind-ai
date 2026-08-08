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
  readonly onSaved: () => void;
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
  const [profileSaved, setProfileSaved] = useState(false);
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

  const handleSaveProfile = async () => {
    setIsSavingProfile(true);
    setSaveError(null);
    setProfileSaved(false);
    try {
      await upsertEditorialProfileV2(cycleId, {
        audience_nuance: audienceNuance,
        voice,
        language,
        writing_guardrails: guardrails.filter((g) => g.trim().length > 0),
        default_visual_guidance: visualGuidance.trim() || null,
      });
      setProfileSaved(true);
      onSaved();
    } catch {
      setSaveError("saveFailed");
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handleAddCta = async () => {
    if (!newCtaLabel.trim() || isAddingCta) return;
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
      onSaved();
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
          className="text-xs font-bold text-action hover:underline"
        >
          ← {t("title")}
        </button>
        <h1 className="text-xl font-bold text-navy">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("intro")}</p>
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

      {profileSaved && (
        <div
          role="status"
          className="rounded-lg border border-primary/30 bg-primary/10 p-3.5 text-xs font-semibold text-primary"
        >
          {t("savedProfile")}
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
          <label className="space-y-1.5">
            <span className="text-xs font-semibold text-navy">
              {t("audienceNuance")}
            </span>
            <textarea
              value={audienceNuance}
              onChange={(event) => setAudienceNuance(event.target.value)}
              placeholder={t("audienceNuancePlaceholder")}
              rows={3}
              className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-navy placeholder:text-muted-foreground focus:border-primary focus:outline-none"
            />
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-semibold text-navy">
              {t("voice")}
            </span>
            <textarea
              value={voice}
              onChange={(event) => setVoice(event.target.value)}
              placeholder={t("voicePlaceholder")}
              rows={3}
              className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-navy placeholder:text-muted-foreground focus:border-primary focus:outline-none"
            />
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-semibold text-navy">
              {t("language")}
            </span>
            <select
              value={language}
              onChange={(event) =>
                setLanguage(event.target.value as "ar-EG" | "en" | "mixed")
              }
              className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-navy focus:border-primary focus:outline-none"
            >
              <option value="ar-EG">العربية (مصرية)</option>
              <option value="en">English</option>
              <option value="mixed">Mixed / ثنائي</option>
            </select>
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-semibold text-navy">
              {t("visualGuidance")}
            </span>
            <textarea
              value={visualGuidance}
              onChange={(event) => setVisualGuidance(event.target.value)}
              placeholder={t("visualGuidancePlaceholder")}
              rows={3}
              className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-navy placeholder:text-muted-foreground focus:border-primary focus:outline-none"
            />
          </label>
          <div className="space-y-1.5 md:col-span-2">
            <span className="text-xs font-semibold text-navy">
              {t("guardrails")}
            </span>
            {guardrails.map((guardrail, index) => (
              <div key={index} className="flex gap-2">
                <input
                  type="text"
                  value={guardrail}
                  onChange={(event) =>
                    setGuardrails((current) =>
                      current.map((value, i) =>
                        i === index ? event.target.value : value,
                      ),
                    )
                  }
                  className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-navy focus:border-primary focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() =>
                    setGuardrails((current) =>
                      current.filter((_, i) => i !== index),
                    )
                  }
                  aria-label={t("deactivateCta")}
                  className="rounded-lg border border-border px-3 text-xs font-bold text-danger hover:bg-danger/5"
                >
                  ×
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => setGuardrails((current) => [...current, ""])}
              className="text-xs font-bold text-action hover:underline"
            >
              + {t("guardrailsAdd")}
            </button>
          </div>
          <div className="md:col-span-2">
            <button
              type="button"
              onClick={() => void handleSaveProfile()}
              disabled={isSavingProfile || !voice.trim()}
              className="rounded-lg bg-primary px-4 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-primary/90 disabled:opacity-60"
            >
              {isSavingProfile ? t("savingProfile") : t("saveProfile")}
            </button>
          </div>
        </div>
      </section>

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
                          ({t("deactivateCta")})
                        </span>
                      )}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {entry.destination.type}
                      {entry.destination.value
                        ? ` · ${entry.destination.value}`
                        : ""}
                    </p>
                  </div>
                  {entry.active && (
                    <button
                      type="button"
                      onClick={() => void handleDeactivateCta(entry.id)}
                      className="rounded-lg border border-border px-3 py-1 text-[11px] font-bold text-danger hover:bg-danger/5"
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
                className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-navy focus:border-primary focus:outline-none"
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
                className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-navy focus:border-primary focus:outline-none"
              >
                {CTA_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
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
                className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-navy focus:border-primary focus:outline-none"
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
                className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-navy focus:border-primary focus:outline-none"
              />
            </label>
            <button
              type="button"
              onClick={() => void handleAddCta()}
              disabled={isAddingCta || !newCtaLabel.trim()}
              className="self-end rounded-lg bg-action px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-action/90 disabled:opacity-60"
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
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-primary/90">
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
            <p className="text-xs text-muted-foreground">{t("mediaEmpty")}</p>
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
                        ? "AI"
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
                      aria-label={t("deactivateCta")}
                      className="text-[11px] font-bold text-danger hover:underline"
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
  );
}
