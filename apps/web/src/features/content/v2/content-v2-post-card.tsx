"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type {
  ContentChannel,
  ContentCtaLibraryEntryV2,
  ContentFormat,
  ContentMediaLibraryEntryV2,
  ContentPostPlanV2,
} from "@marketmind/contracts";
import { cn } from "@/lib/utils";
import { ContentV2MediaOption } from "./content-v2-media-option";

type EditablePlan = Pick<
  ContentPostPlanV2,
  | "purpose"
  | "intended_audience"
  | "channel"
  | "format"
  | "cta_library_entry_id"
  | "owner_instructions"
  | "visual_direction"
  | "selected_media_ids"
>;

type PostCardProps = {
  readonly cycleId?: string;
  readonly plan: ContentPostPlanV2;
  readonly ctaLabel: string | null;
  readonly ctaUnavailable?: boolean;
  readonly mediaCount: number;
  readonly unavailableMediaCount?: number;
  readonly onEdit?: () => void;
  readonly isEditing?: boolean;
  readonly onCancelEdit?: () => void;
  readonly onSave?: (changes: EditablePlan) => void | Promise<void>;
  readonly ctaEntries?: readonly ContentCtaLibraryEntryV2[];
  readonly mediaEntries?: readonly ContentMediaLibraryEntryV2[];
  readonly mediaDisabled?: boolean;
  readonly onMediaChange?: (mediaIds: readonly string[]) => Promise<void>;
  readonly onUploadMedia?: (
    file: File,
  ) => Promise<ContentMediaLibraryEntryV2>;
  readonly availableChannels?: readonly ContentChannel[];
  readonly availableFormats?: readonly ContentFormat[];
};

export function ContentV2PostCard({
  cycleId,
  plan,
  ctaLabel,
  ctaUnavailable = false,
  mediaCount,
  unavailableMediaCount = 0,
  onEdit,
  isEditing = false,
  onCancelEdit,
  onSave,
  ctaEntries = [],
  mediaEntries = [],
  mediaDisabled = false,
  onMediaChange,
  onUploadMedia,
  availableChannels = [],
  availableFormats = [],
}: PostCardProps) {
  const t = useTranslations("ContentV2.postCard");
  const [draft, setDraft] = useState<EditablePlan | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isMediaPickerOpen, setIsMediaPickerOpen] = useState(false);
  const [isMediaWorking, setIsMediaWorking] = useState(false);
  const [mediaError, setMediaError] = useState(false);
  const editableDraft = draft ?? toEditablePlan(plan);

  const channelOptions = useMemo(
    () => uniqueOptions([...availableChannels, plan.channel]),
    [availableChannels, plan.channel],
  );
  const formatOptions = useMemo(
    () => uniqueOptions([...availableFormats, plan.format]),
    [availableFormats, plan.format],
  );
  const readyMedia = mediaEntries.filter((entry) => entry.status === "ready");
  const readyMediaIds = new Set(readyMedia.map((entry) => entry.id));
  const imageRequired = requiresImage(plan.format);
  const mediaSummary =
    mediaCount > 0
      ? t("mediaSelectedCount", { count: mediaCount })
      : unavailableMediaCount > 0
        ? t("mediaUnavailableSelection")
        : imageRequired
          ? t("autoVisual")
          : t("noVisualNeeded");

  const save = async () => {
    if (!onSave || isSaving || !editableDraft.purpose.trim()) return;
    setIsSaving(true);
    try {
      await onSave({
        ...editableDraft,
        purpose: editableDraft.purpose.trim(),
        intended_audience: editableDraft.intended_audience?.trim() || null,
        owner_instructions: editableDraft.owner_instructions?.trim() || null,
        visual_direction: editableDraft.visual_direction?.trim() || null,
      });
      setDraft(null);
    } catch {
      // The parent keeps the authoritative error message. Keep the local
      // draft open so a transient save failure cannot discard owner edits.
    } finally {
      setIsSaving(false);
    }
  };

  const changeMedia = async (mediaIds: readonly string[]) => {
    if (!onMediaChange || isMediaWorking || mediaDisabled) return;
    setIsMediaWorking(true);
    setMediaError(false);
    try {
      await onMediaChange(mediaIds);
      setDraft((current) =>
        current ? { ...current, selected_media_ids: [...mediaIds] } : current,
      );
    } catch {
      setMediaError(true);
    } finally {
      setIsMediaWorking(false);
    }
  };

  const uploadMedia = async (file: File) => {
    if (!onUploadMedia || isMediaWorking || mediaDisabled) return;
    setIsMediaWorking(true);
    setMediaError(false);
    try {
      const uploaded = await onUploadMedia(file);
      const selected = uniqueOptions([
        ...plan.selected_media_ids,
        uploaded.id,
      ]);
      await onMediaChange?.(selected);
      setDraft((current) =>
        current ? { ...current, selected_media_ids: selected } : current,
      );
    } catch {
      setMediaError(true);
    } finally {
      setIsMediaWorking(false);
    }
  };

  return (
    <article
      className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 shadow-sm"
      aria-label={t("postLabel", { position: plan.position })}
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-sm font-bold text-navy">
          {t("postLabel", { position: plan.position })}
        </h3>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span
            className={cn(
              "rounded-full px-2.5 py-0.5 text-[11px] font-bold",
              plan.plan_state === "ready" && "bg-primary/10 text-primary",
              plan.plan_state === "generating" && "bg-warning/10 text-warning",
              plan.plan_state === "failed" && "bg-danger/10 text-danger",
              plan.plan_state === "planned" && "bg-muted text-muted-foreground",
            )}
          >
            {t(`state.${plan.plan_state}`)}
          </span>
          <span className="rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-semibold text-muted-foreground">
            {t(`source.${plan.source}`)}
          </span>
        </div>
      </div>

      {isEditing ? (
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <label className="block space-y-1">
            <span className="text-xs font-semibold text-navy">
              {t("purposeLabel")}
            </span>
            <textarea
              dir="auto"
              value={editableDraft.purpose}
              onChange={(event) =>
                setDraft((current) => ({
                  ...(current ?? editableDraft),
                  purpose: event.target.value,
                }))
              }
              rows={3}
              required
              className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-navy focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-action"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-semibold text-navy">
              {t("audienceLabel")}
            </span>
            <input
              dir="auto"
              value={editableDraft.intended_audience ?? ""}
              onChange={(event) =>
                setDraft((current) => ({
                  ...(current ?? editableDraft),
                  intended_audience: event.target.value,
                }))
              }
              className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-navy focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-action"
            />
          </label>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block space-y-1">
              <span className="text-xs font-semibold text-navy">
                {t("channelLabel")}
              </span>
              <select
                value={editableDraft.channel}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...(current ?? editableDraft),
                    channel: event.target.value as ContentChannel,
                  }))
                }
                className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-navy focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-action"
              >
                {channelOptions.map((channel) => (
                  <option key={channel} value={channel}>
                    {t(`channels.${channel}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-semibold text-navy">
                {t("formatLabel")}
              </span>
              <select
                value={editableDraft.format}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...(current ?? editableDraft),
                    format: event.target.value as ContentFormat,
                  }))
                }
                className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-navy focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-action"
              >
                {formatOptions.map((format) => (
                  <option key={format} value={format}>
                    {t(`formats.${format}`)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="block space-y-1">
            <span className="text-xs font-semibold text-navy">
              {t("ctaLabel")}
            </span>
            <select
              value={editableDraft.cta_library_entry_id ?? ""}
              onChange={(event) =>
                setDraft((current) => ({
                  ...(current ?? editableDraft),
                  cta_library_entry_id: event.target.value || null,
                }))
              }
              className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-navy focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-action"
            >
              <option value="">{t("noCta")}</option>
              {ctaEntries
                .filter((entry) => entry.active)
                .map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.label}
                  </option>
                ))}
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-semibold text-navy">
              {t("instructionsLabel")}
            </span>
            <textarea
              dir="auto"
              value={editableDraft.owner_instructions ?? ""}
              onChange={(event) =>
                setDraft((current) => ({
                  ...(current ?? editableDraft),
                  owner_instructions: event.target.value,
                }))
              }
              rows={2}
              className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-navy focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-action"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-semibold text-navy">
              {t("visualLabel")}
            </span>
            <textarea
              dir="auto"
              value={editableDraft.visual_direction ?? ""}
              onChange={(event) =>
                setDraft((current) => ({
                  ...(current ?? editableDraft),
                  visual_direction: event.target.value,
                }))
              }
              rows={2}
              className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-navy focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-action"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={isSaving || !editableDraft.purpose.trim()}
              className="rounded-lg bg-primary px-3 py-2 text-xs font-bold text-white hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action disabled:opacity-60"
            >
              {isSaving ? t("savingCta") : t("saveCta")}
            </button>
            <button
              type="button"
              onClick={() => {
                setDraft(null);
                onCancelEdit?.();
              }}
              className="rounded-lg border border-border px-3 py-2 text-xs font-bold text-navy hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action"
            >
              {t("cancelCta")}
            </button>
          </div>
        </form>
      ) : (
        <>
          <p dir="auto" className="text-xs leading-relaxed text-navy">
            {plan.purpose}
          </p>

          {plan.intended_audience && (
            <dl className="grid grid-cols-1 gap-2 text-xs">
              <div>
                <dt className="font-semibold text-muted-foreground">
                  {t("audienceLabel")}
                </dt>
                <dd dir="auto" className="mt-0.5 text-navy">
                  {plan.intended_audience}
                </dd>
              </div>
            </dl>
          )}

          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
            <div>
              <dt className="font-semibold text-muted-foreground">
                {t("channelLabel")}
              </dt>
              <dd className="mt-0.5 font-semibold text-navy">
                {t(`channels.${plan.channel}`)}
              </dd>
            </div>
            <div>
              <dt className="font-semibold text-muted-foreground">
                {t("formatLabel")}
              </dt>
              <dd className="mt-0.5 font-semibold text-navy">
                {t(`formats.${plan.format}`)}
              </dd>
            </div>
            <div>
              <dt className="font-semibold text-muted-foreground">
                {t("ctaLabel")}
              </dt>
              <dd
                dir="auto"
                className={cn(
                  "mt-0.5 text-navy",
                  (ctaUnavailable || ctaLabel) && "font-semibold",
                  ctaUnavailable && "text-warning",
                )}
              >
                {ctaUnavailable
                  ? t("ctaUnavailable")
                  : (ctaLabel ?? t("noCta"))}
              </dd>
            </div>
            <div>
              <dt className="font-semibold text-muted-foreground">
                {t("mediaLabel")}
              </dt>
              <dd className="mt-0.5 text-navy">
                {mediaSummary}
                {unavailableMediaCount > 0 && (
                  <span className="ms-1 text-warning">
                    ({t("mediaUnavailable", { count: unavailableMediaCount })})
                  </span>
                )}
              </dd>
            </div>
          </dl>

          {plan.visual_direction && (
            <p dir="auto" className="text-xs text-muted-foreground">
              <span className="font-semibold">{t("visualLabel")}: </span>
              {plan.visual_direction}
            </p>
          )}
          {plan.owner_instructions && (
            <p dir="auto" className="text-xs text-muted-foreground">
              <span className="font-semibold">{t("instructionsLabel")}: </span>
              {plan.owner_instructions}
            </p>
          )}

          {onEdit && (
            <button
              type="button"
              onClick={() => {
                setDraft(toEditablePlan(plan));
                onEdit();
              }}
              className="mt-auto self-start rounded-lg border border-border px-3 py-1.5 text-xs font-bold text-primary hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action"
            >
              {t("editCta")}
            </button>
          )}
        </>
      )}

      {cycleId && onMediaChange && onUploadMedia ? (
        <section
          aria-label={t("mediaLabel")}
          className="space-y-3 border-t border-border pt-3"
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="space-y-0.5">
              <p className="text-xs font-bold text-navy">
                {imageRequired ? t("photoRequired") : t("photoOptional")}
              </p>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                {imageRequired
                  ? t("photoRequiredHelp")
                  : t("photoOptionalHelp")}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <label className="inline-flex cursor-pointer items-center rounded-lg bg-primary px-3 py-2 text-xs font-bold text-white hover:bg-primary/90 focus-within:ring-2 focus-within:ring-action">
                {isMediaWorking ? t("uploadingPhoto") : t("uploadPhoto")}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="sr-only"
                  disabled={isMediaWorking || mediaDisabled}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void uploadMedia(file);
                    event.target.value = "";
                  }}
                />
              </label>
              {readyMedia.length > 0 ? (
                <button
                  type="button"
                  onClick={() =>
                    setIsMediaPickerOpen((current) => !current)
                  }
                  disabled={isMediaWorking || mediaDisabled}
                  aria-expanded={isMediaPickerOpen}
                  className="rounded-lg border border-border px-3 py-2 text-xs font-bold text-navy hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action disabled:opacity-60"
                >
                  {t("chooseSavedPhoto")}
                </button>
              ) : null}
            </div>
          </div>

          {mediaError ? (
            <p role="alert" className="text-[11px] font-semibold text-danger">
              {t("photoSaveFailed")}
            </p>
          ) : null}

          {unavailableMediaCount > 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-warning/30 bg-warning/5 p-2">
              <p className="text-[11px] text-warning">
                {t("mediaUnavailableHelp")}
              </p>
              <button
                type="button"
                onClick={() =>
                  void changeMedia(
                    plan.selected_media_ids.filter((id) =>
                      readyMediaIds.has(id),
                    ),
                  )
                }
                disabled={isMediaWorking || mediaDisabled}
                className="rounded-sm text-[11px] font-bold text-action hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action"
              >
                {t("removeUnavailable")}
              </button>
            </div>
          ) : null}

          {isMediaPickerOpen ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {readyMedia.map((entry) => (
                <ContentV2MediaOption
                  key={entry.id}
                  cycleId={cycleId}
                  entry={entry}
                  selected={plan.selected_media_ids.includes(entry.id)}
                  disabled={isMediaWorking || mediaDisabled}
                  onSelect={() => {
                    const selected = plan.selected_media_ids.includes(entry.id)
                      ? plan.selected_media_ids.filter((id) => id !== entry.id)
                      : [...plan.selected_media_ids, entry.id];
                    void changeMedia(selected);
                  }}
                />
              ))}
            </div>
          ) : null}
        </section>
      ) : null}
    </article>
  );
}

function toEditablePlan(plan: ContentPostPlanV2): EditablePlan {
  return {
    purpose: plan.purpose,
    intended_audience: plan.intended_audience,
    channel: plan.channel,
    format: plan.format,
    cta_library_entry_id: plan.cta_library_entry_id,
    owner_instructions: plan.owner_instructions,
    visual_direction: plan.visual_direction,
    selected_media_ids: [...plan.selected_media_ids],
  };
}

function uniqueOptions<T extends string>(options: readonly T[]): T[] {
  return [...new Set(options)];
}

function requiresImage(format: ContentFormat): boolean {
  return format === "static_image_post" || format === "carousel_brief";
}
