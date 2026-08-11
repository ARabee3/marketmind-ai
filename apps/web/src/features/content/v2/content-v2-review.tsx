"use client";

import { useCallback, useEffect, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import Image from "next/image";
import { Link } from "@/i18n/navigation";
import type {
  ContentItemVersionV2,
  ContentPackWorkspaceV2,
} from "@marketmind/contracts";
import {
  getPackWorkspaceV2,
  directEditV2,
  rewriteItemV2,
  attachMediaV2,
  generateMediaV2,
  getMediaFileV2,
  uploadMediaV2,
} from "@/lib/api/content-v2";
import { submitItemDecision } from "@/lib/api/content-review";
import { createIdempotencyKey } from "@/lib/api/publishing";
import { cn } from "@/lib/utils";
import { ContentV2MediaOption } from "./content-v2-media-option";

type ReviewProps = {
  readonly packId: string;
};

export function ContentV2ReviewWorkspace({ packId }: ReviewProps) {
  const t = useTranslations("ContentV2.review");
  const tStudio = useTranslations("ContentV2.studio");
  const tErrors = useTranslations("ContentV2.errors");
  const format = useFormatter();

  const [workspace, setWorkspace] = useState<ContentPackWorkspaceV2 | null>(
    null,
  );
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [actionError, setActionError] = useState<
    | "approvalFailed"
    | "saveFailed"
    | "rewriteFailed"
    | "conflict"
    | "assetRequired"
    | "mediaFailed"
    | null
  >(null);
  const [notice, setNotice] = useState<
    "approved" | "approvedWithCandidate" | "saved" | "rewritten" | null
  >(null);

  const load = useCallback(async () => {
    try {
      const data = await getPackWorkspaceV2(packId);
      setWorkspace(data);
      setPhase("ready");
    } catch {
      setPhase("error");
    }
  }, [packId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    if (
      !workspace ||
      !workspace.items.some((item) =>
        item.assets?.some((asset) => asset.status === "generating"),
      )
    ) {
      return;
    }
    const interval = window.setInterval(() => void load(), 2000);
    return () => window.clearInterval(interval);
  }, [load, workspace]);

  const handleChanged = useCallback(async () => {
    setActionError(null);
    await load();
  }, [load]);

  const handleError = useCallback(
    (key: string) => {
      const typedKey = key as
        | "approvalFailed"
        | "saveFailed"
        | "rewriteFailed"
        | "conflict"
        | "assetRequired"
        | "mediaFailed";
      setNotice(null);
      setActionError(typedKey);
      // A version conflict means every child has stale ids/checksums. Reload
      // immediately; the version-based item key below also closes any stale
      // inline editor once the authoritative response arrives.
      if (typedKey === "conflict") void load();
    },
    [load],
  );

  const handleNotice = useCallback((key: string) => {
    setActionError(null);
    setNotice(
      key as "approved" | "approvedWithCandidate" | "saved" | "rewritten",
    );
  }, []);

  if (phase === "loading") {
    return (
      <div className="py-12 text-center text-sm font-semibold text-muted-foreground">
        {t("loading")}
      </div>
    );
  }

  if (phase === "error" || !workspace) {
    return (
      <div className="mx-auto max-w-xl py-12 text-center space-y-4">
        <div className="rounded-xl border border-danger/30 bg-danger/10 p-6 text-danger space-y-3">
          <p className="text-sm font-bold">{tErrors("loadFailed")}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-lg bg-danger px-4 py-2 text-xs font-bold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger"
          >
            {tErrors("refresh")}
          </button>
        </div>
      </div>
    );
  }

  const approvedCount = workspace.items.filter(
    (item) => item.decision?.decision === "approved",
  ).length;
  const packIsApproved =
    workspace.pack.status === "approved" ||
    (workspace.items.length > 0 && approvedCount === workspace.items.length);

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <Link
          href={`/content/${workspace.pack.content_cycle_id}/studio` as never}
          className="rounded-sm text-xs font-bold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action"
        >
          {t("backToStudio")}
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-bold text-navy">
            {packIsApproved ? t("approvedTitle") : t("title")}
          </h1>
          <span
            className={cn(
              "rounded-full px-2.5 py-1 text-xs font-bold",
              packIsApproved
                ? "bg-primary/10 text-primary"
                : "bg-muted text-muted-foreground",
            )}
          >
            {packIsApproved
              ? t("packApproved")
              : t("approvalProgress", {
                  approved: approvedCount,
                  total: workspace.items.length,
                })}
          </span>
        </div>
        <p className="text-sm text-muted-foreground">
          {tStudio("weekBadge", { week: workspace.week_number })} ·{" "}
          {format.dateTime(new Date(workspace.week_start_date), {
            timeZone: "Africa/Cairo",
            day: "numeric",
            month: "long",
          })}
        </p>
      </header>

      {actionError && (
        <div
          role="alert"
          aria-live="polite"
          className="rounded-lg border border-danger/30 bg-danger/10 p-3.5 text-xs font-semibold text-danger"
        >
          {t(actionError)}
        </div>
      )}
      {notice && (
        <div
          role="status"
          className="rounded-lg border border-primary/30 bg-primary/10 p-3.5 text-xs font-semibold text-primary"
        >
          {t(notice)}
        </div>
      )}

      {packIsApproved && (
        <section
          role="status"
          className="rounded-xl border border-primary/30 bg-primary/10 p-4 text-primary"
        >
          <p className="text-sm font-bold">{t("approvedReadOnlyTitle")}</p>
          <p className="mt-1 text-xs leading-relaxed">
            {t("approvedReadOnlyBody")}
          </p>
        </section>
      )}

      {workspace.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <ol className="grid grid-cols-1 gap-6">
          {workspace.items.map((item) => (
            <li key={`${item.content_item_id}:${item.current_version.id}`}>
              <ReviewItem
                packId={workspace.pack.id}
                cycleId={workspace.pack.content_cycle_id}
                item={item}
                readOnly={packIsApproved}
                mediaEntries={workspace.media_library ?? []}
                onChanged={handleChanged}
                onError={handleError}
                onNotice={handleNotice}
              />
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

type ReviewItemProps = {
  readonly packId: string;
  readonly cycleId: string;
  readonly item: ContentPackWorkspaceV2["items"][number];
  readonly readOnly: boolean;
  readonly mediaEntries: NonNullable<ContentPackWorkspaceV2["media_library"]>;
  readonly onChanged: () => Promise<void>;
  readonly onError: (key: string) => void;
  readonly onNotice: (key: string) => void;
};

function ReviewItem({
  packId,
  cycleId,
  item,
  readOnly,
  mediaEntries,
  onChanged,
  onError,
  onNotice,
}: ReviewItemProps) {
  const t = useTranslations("ContentV2.review");
  const format = useFormatter();
  const version = item.current_version;
  const isApproved = item.decision?.decision === "approved";
  const isFrozen = readOnly || isApproved;
  const [isApproving, setIsApproving] = useState(false);
  const visibleBlockers = isFrozen
    ? []
    : version.blockers.filter(
        (blocker) => blocker !== "CONTENT_ASSET_REQUIRED",
      );

  const handleApprove = async () => {
    if (isApproving) return;
    setIsApproving(true);
    try {
      await approve(packId, item, onChanged, onError, onNotice);
    } finally {
      setIsApproving(false);
    }
  };

  return (
    <article
      id={`item-${item.content_item_id}`}
      className="rounded-xl border border-border bg-surface p-4 shadow-sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-bold text-navy">
          {item.plan ? item.plan.purpose : t("postTitle")}
        </h2>
        <span className="rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-bold text-muted-foreground">
          {t(`channels.${version.channel}`)} · {t(`formats.${version.format}`)}
        </span>
      </div>

      <MediaWell
        cycleId={cycleId}
        packId={packId}
        item={item}
        readOnly={isFrozen}
        mediaEntries={mediaEntries}
        onChanged={onChanged}
        onError={onError}
      />

      {/* Caption / copy */}
      <section aria-label={t("copySection")} className="mt-4 space-y-3">
        {version.caption_variants.map((variant) => (
          <div
            key={variant.locale}
            className="rounded-lg border border-border bg-bg p-3"
          >
            <p
              dir={variant.locale === "ar" ? "rtl" : "ltr"}
              className="text-sm leading-relaxed text-navy"
            >
              {variant.caption}
            </p>
            <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
              {variant.cta && (
                <span className="rounded-full bg-primary/10 px-2 py-0.5 font-semibold text-primary">
                  {t("ctaTag")}: {variant.cta}
                </span>
              )}
              {variant.hashtags.length > 0 && (
                <span>{variant.hashtags.join(" ")}</span>
              )}
            </div>
          </div>
        ))}
        {(version.asset_required || version.asset_ids.length > 0) && (
          <p className="text-[11px] text-muted-foreground">
            {t("altText")}: {version.alt_text}
          </p>
        )}
        <p className="text-[11px] text-muted-foreground">
          {t("timing")}:{" "}
          {format.dateTime(
            new Date(version.recommended_publish_window.starts_at),
            {
              timeZone: "Africa/Cairo",
              dateStyle: "medium",
              timeStyle: "short",
            },
          )}{" "}
          –{" "}
          {format.dateTime(
            new Date(version.recommended_publish_window.ends_at),
            {
              timeZone: "Africa/Cairo",
              dateStyle: "medium",
              timeStyle: "short",
            },
          )}
        </p>
      </section>

      {!isFrozen &&
        (version.warnings.length > 0 || visibleBlockers.length > 0) && (
          <section
            aria-label={t("attentionSection")}
            className="mt-4 space-y-2 rounded-lg border border-warning/30 bg-warning/5 p-3"
          >
            <h3 className="text-xs font-bold text-navy">
              {t("attentionSection")}
            </h3>
            {visibleBlockers.length > 0 && (
              <ul className="list-disc space-y-1 ps-5 text-xs text-danger">
                {visibleBlockers.map((blocker) => (
                  <li key={blocker}>{t(blockerMessageKey(blocker))}</li>
                ))}
              </ul>
            )}
            {version.warnings.length > 0 && (
              <ul className="list-disc space-y-1 ps-5 text-xs text-warning">
                {version.warnings.map((warning, index) => (
                  <li key={`${warning}:${index}`}>
                    {t(blockerMessageKey(warning))}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

      {!isFrozen &&
        item.approval_state &&
        item.approval_state !== "ready" &&
        item.approval_state !== "approved" && (
          <p className="mt-3 rounded-lg border border-warning/30 bg-warning/5 p-3 text-xs font-semibold text-warning">
            {item.approval_state === "media_generating"
              ? t("mediaGenerating")
              : item.approval_state === "media_failed"
                ? t("mediaFailed")
                : t("assetRequired")}
          </p>
        )}

      <div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground">
        {version.generation_provenance.provider_name === "mock" && (
          <span className="rounded-full bg-warning/10 px-2 py-0.5 font-semibold text-warning">
            {t("simulatedOutput")}
          </span>
        )}
      </div>

      {/* Actions */}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        {!isFrozen && (
          <>
            <InlineEditButton
              packId={packId}
              itemId={item.content_item_id}
              version={version}
              onChanged={onChanged}
              onError={onError}
              onNotice={onNotice}
            />
            <RewriteButton
              packId={packId}
              itemId={item.content_item_id}
              version={version}
              onChanged={onChanged}
              onError={onError}
              onNotice={onNotice}
            />
          </>
        )}
        {!isFrozen && !item.decision && (
          <button
            type="button"
            onClick={() => void handleApprove()}
            disabled={
              isApproving ||
              (item.approval_state
                ? item.approval_state !== "ready"
                : version.blockers.length > 0)
            }
            className="rounded-lg bg-primary px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isApproving ? t("approving") : t("approveCta")}
          </button>
        )}
        {isFrozen && (
          <p
            role="status"
            className="w-full rounded-lg border border-primary/30 bg-primary/10 p-3 text-xs font-semibold text-primary"
          >
            {t("approvedItemReadOnly")}
          </p>
        )}
        {item.decision && (
          <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-bold text-primary">
            {t(`decision.${item.decision.decision}`)}
          </span>
        )}
      </div>
    </article>
  );
}

function MediaWell({
  cycleId,
  packId,
  item,
  readOnly,
  mediaEntries,
  onChanged,
  onError,
}: {
  readonly cycleId: string;
  readonly packId: string;
  readonly item: ContentPackWorkspaceV2["items"][number];
  readonly readOnly: boolean;
  readonly mediaEntries: NonNullable<ContentPackWorkspaceV2["media_library"]>;
  readonly onChanged: () => Promise<void>;
  readonly onError: (key: string) => void;
}) {
  const t = useTranslations("ContentV2.review");
  const version = item.current_version;
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [isWorking, setIsWorking] = useState(false);
  const [preview, setPreview] = useState<{
    assetId: string;
    url: string;
  } | null>(null);
  const currentAsset = (item.assets ?? []).find((asset) =>
    version.asset_ids.includes(asset.id),
  );
  const currentAssetId = currentAsset?.id ?? null;
  const currentAssetStatus = currentAsset?.status ?? "missing";
  const readyMedia = mediaEntries.filter((entry) => entry.status === "ready");
  const mediaRequired = version.asset_required;
  const showPreview = mediaRequired || Boolean(currentAsset);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    if (!currentAssetId || currentAssetStatus !== "ready") {
      return () => undefined;
    }
    void getMediaFileV2(cycleId, currentAssetId)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setPreview({ assetId: currentAssetId, url: objectUrl });
      })
      .catch(() => {
        if (!cancelled) {
          setPreview((current) =>
            current?.assetId === currentAssetId ? null : current,
          );
        }
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [cycleId, currentAssetId, currentAssetStatus]);

  const attach = async (mediaId: string, alreadyWorking = false) => {
    if (isWorking && !alreadyWorking) return;
    setIsWorking(true);
    try {
      await attachMediaV2(packId, item.content_item_id, {
        contract_version: "content-v2",
        base_version_id: version.id,
        base_version_checksum: version.version_checksum,
        media_id: mediaId,
        idempotency_key: createIdempotencyKey(),
      });
      setIsPickerOpen(false);
      await onChanged();
    } catch (error: unknown) {
      onError(
        (error as { code?: string }).code === "CONTENT_VERSION_CONFLICT"
          ? "conflict"
          : "mediaFailed",
      );
    } finally {
      setIsWorking(false);
    }
  };

  const generate = async () => {
    if (isWorking) return;
    setIsWorking(true);
    try {
      await generateMediaV2(packId, item.content_item_id, {
        contract_version: "content-v2",
        base_version_id: version.id,
        base_version_checksum: version.version_checksum,
        visual_instruction: instruction.trim() || undefined,
        idempotency_key: createIdempotencyKey(),
      });
      setIsPickerOpen(false);
      setInstruction("");
      await onChanged();
    } catch (error: unknown) {
      onError(
        (error as { code?: string }).code === "CONTENT_VERSION_CONFLICT"
          ? "conflict"
          : "mediaFailed",
      );
    } finally {
      setIsWorking(false);
    }
  };

  const upload = async (file: File) => {
    if (isWorking) return;
    setIsWorking(true);
    try {
      const result = await uploadMediaV2(cycleId, file);
      await attach(result.media.id, true);
    } catch {
      onError("mediaFailed");
      setIsWorking(false);
    }
  };

  const mediaState = currentAsset?.status ?? "missing";
  return (
    <section
      aria-label={t("mediaSection")}
      className={cn(
        "mt-4 gap-4 rounded-xl border border-border bg-bg p-3",
        showPreview && "grid md:grid-cols-[minmax(10rem,15rem)_1fr]",
      )}
    >
      {showPreview ? (
        <div className="flex aspect-square items-center justify-center overflow-hidden rounded-lg border border-border bg-muted">
          {preview?.assetId === currentAssetId &&
          currentAssetStatus === "ready" ? (
            <Image
              src={preview.url}
              alt={currentAsset?.alt_text ?? version.alt_text}
              width={600}
              height={600}
              unoptimized
              className="size-full object-cover"
            />
          ) : (
            <p className="px-4 text-center text-xs text-muted-foreground">
              {mediaState === "generating"
                ? t("mediaGenerating")
                : mediaState === "failed"
                  ? t("mediaFailed")
                  : t("assetRequired")}
            </p>
          )}
        </div>
      ) : null}
      <div className="flex min-w-0 flex-col gap-3">
        <div>
          <p className="text-xs font-bold text-navy">
            {mediaRequired ? t("mediaRequired") : t("mediaOptional")}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {mediaState === "ready"
              ? t("mediaReady")
              : mediaState === "generating"
                ? t("mediaGenerating")
                : mediaState === "failed"
                  ? t("mediaFailed")
                  : mediaRequired
                    ? t("assetRequired")
                    : t("mediaOptionalHelp")}
          </p>
        </div>
        {!readOnly && (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setIsPickerOpen((current) => !current)}
              className="rounded-lg border border-border px-3 py-2 text-xs font-bold text-navy hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action"
            >
              {mediaState === "ready" ? t("mediaChange") : t("mediaChoose")}
            </button>
            <button
              type="button"
              onClick={() => void generate()}
              disabled={isWorking}
              className="rounded-lg bg-primary px-3 py-2 text-xs font-bold text-white hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action disabled:opacity-60"
            >
              {isWorking
                ? t("generatingMedia")
                : mediaState === "ready"
                  ? t("mediaRegenerate")
                  : t("mediaGenerate")}
            </button>
          </div>
        )}
        {isPickerOpen && !readOnly && (
          <div className="space-y-3 rounded-lg border border-border bg-surface p-3">
            <label className="block space-y-1">
              <span className="text-[11px] font-semibold text-navy">
                {t("mediaInstructionLabel")}
              </span>
              <input
                dir="auto"
                value={instruction}
                onChange={(event) => setInstruction(event.target.value)}
                placeholder={t("mediaInstructionPlaceholder")}
                className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-xs text-navy focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-action"
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <label className="inline-flex cursor-pointer items-center rounded-lg border border-border px-3 py-2 text-xs font-bold text-navy hover:bg-muted focus-within:ring-2 focus-within:ring-action">
                {isWorking ? t("uploadingMedia") : t("mediaUpload")}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="sr-only"
                  disabled={isWorking}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void upload(file);
                    event.target.value = "";
                  }}
                />
              </label>
              {readyMedia.map((entry) => (
                <ContentV2MediaOption
                  key={entry.id}
                  cycleId={cycleId}
                  entry={entry}
                  selected={entry.id === currentAssetId}
                  disabled={isWorking}
                  onSelect={() => void attach(entry.id)}
                />
              ))}
            </div>
            {readyMedia.length === 0 && (
              <p className="text-[11px] text-muted-foreground">
                {t("mediaEmpty")}
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function InlineEditButton({
  packId,
  itemId,
  version,
  onChanged,
  onError,
  onNotice,
}: {
  packId: string;
  itemId: string;
  version: ContentItemVersionV2;
  onChanged: () => Promise<void>;
  onError: (key: string) => void;
  onNotice: (key: string) => void;
}) {
  const t = useTranslations("ContentV2.review");
  const [draft, setDraft] = useState<{
    captions: Record<string, string>;
    cta: string;
    hashtags: string;
    altText: string;
    creativeBrief: string;
  } | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    if (draft === null || isSaving) return;
    setIsSaving(true);
    try {
      const normalizedCta = draft.cta.trim() || null;
      const normalizedHashtags =
        version.channel === "google_business_profile"
          ? []
          : normalizeEditableHashtags(draft.hashtags);
      const captionVariants = version.caption_variants.map((variant) =>
        Object.prototype.hasOwnProperty.call(draft.captions, variant.locale)
          ? {
              ...variant,
              caption: draft.captions[variant.locale],
              cta: normalizedCta,
              hashtags: normalizedHashtags,
            }
          : variant,
      );
      await directEditV2(packId, itemId, {
        contract_version: "content-v2",
        content_item_id: itemId,
        base_version_id: version.id,
        base_version_checksum: version.version_checksum,
        caption_variants: captionVariants,
        cta: normalizedCta,
        hashtags: normalizedHashtags,
        alt_text: draft.altText.trim(),
        creative_brief: draft.creativeBrief.trim(),
        idempotency_key: createIdempotencyKey(),
      });
      setDraft(null);
      onNotice("saved");
      await onChanged();
    } catch (err: unknown) {
      onError(
        (err as { code?: string }).code === "CONTENT_VERSION_CONFLICT"
          ? "conflict"
          : "saveFailed",
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {draft === null ? (
        <button
          type="button"
          onClick={() =>
            setDraft({
              captions: Object.fromEntries(
                version.caption_variants.map((variant) => [
                  variant.locale,
                  variant.caption,
                ]),
              ),
              cta: version.cta ?? "",
              hashtags: version.hashtags.join(" "),
              altText: version.alt_text,
              creativeBrief: version.creative_brief,
            })
          }
          className="rounded-lg border border-border px-3 py-2 text-xs font-bold text-navy hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action"
        >
          {t("editInlineCta")}
        </button>
      ) : (
        <>
          {version.caption_variants.map((variant) => (
            <label key={variant.locale} className="w-full space-y-1">
              <span className="text-xs font-semibold text-muted-foreground">
                {t(`language.${variant.locale}`)}
              </span>
              <textarea
                value={draft.captions[variant.locale] ?? ""}
                onChange={(event) =>
                  setDraft((current) =>
                    current
                      ? {
                          ...current,
                          captions: {
                            ...current.captions,
                            [variant.locale]: event.target.value,
                          },
                        }
                      : current,
                  )
                }
                dir={variant.locale === "ar" ? "rtl" : "ltr"}
                rows={3}
                className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-navy focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-action"
              />
            </label>
          ))}
          <label className="w-full space-y-1">
            <span className="text-xs font-semibold text-muted-foreground">
              {t("ctaField")}
            </span>
            <input
              dir="auto"
              value={draft.cta}
              onChange={(event) =>
                setDraft((current) =>
                  current ? { ...current, cta: event.target.value } : current,
                )
              }
              className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-navy focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-action"
            />
          </label>
          <label className="w-full space-y-1">
            <span className="text-xs font-semibold text-muted-foreground">
              {t("hashtagsField")}
            </span>
            <input
              dir="auto"
              value={draft.hashtags}
              onChange={(event) =>
                setDraft((current) =>
                  current
                    ? { ...current, hashtags: event.target.value }
                    : current,
                )
              }
              className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-navy focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-action"
            />
          </label>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={
              isSaving ||
              Object.values(draft.captions).some((caption) => !caption.trim())
            }
            className="rounded-lg bg-primary px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action disabled:opacity-60"
          >
            {isSaving ? t("saving") : t("saveEditCta")}
          </button>
          <button
            type="button"
            onClick={() => setDraft(null)}
            className="rounded-lg border border-border px-3 py-2 text-xs font-bold text-navy hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action"
          >
            {t("cancelCta")}
          </button>
        </>
      )}
    </div>
  );
}

function RewriteButton({
  packId,
  itemId,
  version,
  onChanged,
  onError,
  onNotice,
}: {
  packId: string;
  itemId: string;
  version: ContentItemVersionV2;
  onChanged: () => Promise<void>;
  onError: (key: string) => void;
  onNotice: (key: string) => void;
}) {
  const t = useTranslations("ContentV2.review");
  const [notes, setNotes] = useState<string | null>(null);
  const [isRewriting, setIsRewriting] = useState(false);

  const handleRewrite = async () => {
    if (!notes?.trim() || isRewriting) return;
    setIsRewriting(true);
    try {
      await rewriteItemV2(packId, itemId, {
        contract_version: "content-v2",
        base_version_id: version.id,
        base_version_checksum: version.version_checksum,
        revision_notes: notes.trim(),
        idempotency_key: createIdempotencyKey(),
      });
      setNotes(null);
      onNotice("rewritten");
      await onChanged();
    } catch (err: unknown) {
      onError(
        (err as { code?: string }).code === "CONTENT_VERSION_CONFLICT"
          ? "conflict"
          : "rewriteFailed",
      );
    } finally {
      setIsRewriting(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {notes === null ? (
        <button
          type="button"
          onClick={() => setNotes("")}
          className="rounded-lg border border-primary/40 px-3 py-2 text-xs font-bold text-primary hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action"
        >
          {t("rewriteCta")}
        </button>
      ) : (
        <>
          <input
            dir="auto"
            type="text"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            aria-label={t("rewriteNotesLabel")}
            placeholder={t("rewriteNotesPlaceholder")}
            className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-navy focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-action"
          />
          <button
            type="button"
            onClick={() => void handleRewrite()}
            disabled={isRewriting || !notes.trim()}
            className="rounded-lg bg-primary px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action disabled:opacity-60"
          >
            {isRewriting ? t("rewriting") : t("rewriteConfirmCta")}
          </button>
          <button
            type="button"
            onClick={() => setNotes(null)}
            className="rounded-lg border border-border px-3 py-2 text-xs font-bold text-navy hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action"
          >
            {t("cancelCta")}
          </button>
        </>
      )}
    </div>
  );
}

async function approve(
  packId: string,
  item: ContentPackWorkspaceV2["items"][number],
  onChanged: () => Promise<void>,
  onError: (key: string) => void,
  onNotice: (key: string) => void,
) {
  try {
    const result = await submitItemDecision(packId, item.content_item_id, {
      item_id: item.content_item_id,
      version_id: item.current_version.id,
      checksum: item.current_version.version_checksum,
      decision: "approve",
      notes: null,
      idempotency_key: createIdempotencyKey(),
    });
    onNotice(
      result.publication_candidate ? "approvedWithCandidate" : "approved",
    );
    await onChanged();
  } catch (error: unknown) {
    const code = (error as { code?: string }).code;
    onError(
      code === "CONTENT_VERSION_CONFLICT"
        ? "conflict"
        : code === "CONTENT_ASSET_REQUIRED"
          ? "assetRequired"
          : "approvalFailed",
    );
  }
}

type ReviewBlockerMessageKey =
  | "blockers.unsupportedClaim"
  | "blockers.unapprovedOffer"
  | "blockers.copyNeedsChanges"
  | "blockers.channelMismatch"
  | "blockers.generationProblem"
  | "blockers.platformConstraint"
  | "blockers.generic";

function blockerMessageKey(blocker: string): ReviewBlockerMessageKey {
  switch (blocker) {
    case "CONTENT_UNSUPPORTED_CLAIM":
      return "blockers.unsupportedClaim";
    case "CONTENT_OFFER_UNAPPROVED":
      return "blockers.unapprovedOffer";
    case "CONTENT_POLICY_VIOLATION":
      return "blockers.copyNeedsChanges";
    case "CONTENT_CHANNEL_MISMATCH":
      return "blockers.channelMismatch";
    case "CONTENT_SCHEMA_FAILURE":
    case "CONTENT_PROVIDER_FAILURE":
      return "blockers.generationProblem";
    case "CONTENT_PLATFORM_CONSTRAINT":
      return "blockers.platformConstraint";
    default:
      return "blockers.generic";
  }
}

function normalizeEditableHashtags(value: string): string[] {
  const normalized: string[] = [];
  for (const fragment of value.split(/[\s,،;؛]+/)) {
    for (const token of fragment.split("#")) {
      const trimmed = token.trim();
      if (!trimmed) continue;
      const hashtag = `#${trimmed}`;
      if (!normalized.includes(hashtag)) normalized.push(hashtag);
    }
  }
  return normalized;
}
