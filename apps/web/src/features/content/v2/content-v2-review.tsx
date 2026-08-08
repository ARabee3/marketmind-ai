"use client";

import { useCallback, useEffect, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import type {
  ContentItemVersionV2,
  ContentPackWorkspaceV2,
} from "@marketmind/contracts";
import {
  getPackWorkspaceV2,
  directEditV2,
  rewriteItemV2,
} from "@/lib/api/content-v2";
import { submitItemDecision } from "@/lib/api/content-review";
import { createIdempotencyKey } from "@/lib/api/publishing";

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
    "approvalFailed" | "saveFailed" | "rewriteFailed" | "conflict" | null
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
            className="rounded-lg bg-danger px-4 py-2 text-xs font-bold text-white"
          >
            {tErrors("refresh")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <Link
          href={`/content/${workspace.pack.content_cycle_id}/studio` as never}
          className="text-xs font-bold text-action hover:underline"
        >
          {t("backToStudio")}
        </Link>
        <h1 className="text-xl font-bold text-navy">{t("title")}</h1>
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

      {workspace.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <ol className="grid grid-cols-1 gap-6">
          {workspace.items.map((item) => (
            <li key={item.content_item_id}>
              <ReviewItem
                packId={workspace.pack.id}
                item={item}
                onChanged={() => void load()}
                onError={(key) =>
                  setActionError(
                    key as
                      | "approvalFailed"
                      | "saveFailed"
                      | "rewriteFailed"
                      | "conflict",
                  )
                }
                onNotice={(key) =>
                  setNotice(
                    key as
                      | "approved"
                      | "approvedWithCandidate"
                      | "saved"
                      | "rewritten",
                  )
                }
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
  readonly item: ContentPackWorkspaceV2["items"][number];
  readonly onChanged: () => void;
  readonly onError: (key: string) => void;
  readonly onNotice: (key: string) => void;
};

function ReviewItem({
  packId,
  item,
  onChanged,
  onError,
  onNotice,
}: ReviewItemProps) {
  const t = useTranslations("ContentV2.review");
  const format = useFormatter();
  const version = item.current_version;

  return (
    <article
      id={`item-${item.content_item_id}`}
      className="rounded-xl border border-border bg-surface p-4 shadow-sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-bold text-navy">
          {item.plan ? item.plan.purpose : t("postTitle")}
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-bold text-muted-foreground">
            {version.channel} · {version.format}
          </span>
          {version.edit_metadata && (
            <span className="rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-bold text-muted-foreground">
              v{version.version}
            </span>
          )}
        </div>
      </div>

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
        <p className="text-[11px] text-muted-foreground">
          {t("altText")}: {version.alt_text}
        </p>
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

      {/* Version history */}
      <section aria-label={t("historySection")} className="mt-4 space-y-1">
        <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
          {t("historySection")}
        </h3>
        <ol className="space-y-1">
          {[...item.versions]
            .sort((a, b) => a.version - b.version)
            .map((entry) => (
              <VersionRow key={entry.id} version={entry} />
            ))}
        </ol>
      </section>

      {/* Actions */}
      <div className="mt-4 flex flex-wrap items-center gap-3">
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
        {!item.decision && (
          <button
            type="button"
            onClick={() =>
              void approve(packId, item, onChanged, onError, onNotice)
            }
            className="rounded-lg bg-primary px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-primary/90"
          >
            {t("approveCta")}
          </button>
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

function VersionRow({ version }: { version: ContentItemVersionV2 }) {
  const t = useTranslations("ContentV2.review");
  return (
    <li className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
      <span className="font-bold text-navy">v{version.version}</span>
      <span>{t(`editKind.${version.edit_metadata.edit_kind}`)}</span>
      <code className="rounded bg-muted px-1.5 py-0.5 text-[10px]">
        {version.version_checksum.slice(0, 12)}…
      </code>
    </li>
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
  onChanged: () => void;
  onError: (key: string) => void;
  onNotice: (key: string) => void;
}) {
  const t = useTranslations("ContentV2.review");
  const [draft, setDraft] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const arabicCaption =
    version.caption_variants.find((variant) => variant.locale === "ar") ?? null;

  const handleSave = async () => {
    if (draft === null || isSaving) return;
    setIsSaving(true);
    try {
      const captionVariants = version.caption_variants.map((variant) =>
        variant.locale === "ar" && arabicCaption
          ? { ...variant, caption: draft }
          : variant,
      );
      await directEditV2(packId, itemId, {
        contract_version: "content-v2",
        content_item_id: itemId,
        base_version_id: version.id,
        base_version_checksum: version.version_checksum,
        caption_variants: captionVariants,
        cta: version.cta,
        hashtags: version.hashtags,
        alt_text: version.alt_text,
        creative_brief: version.creative_brief,
        idempotency_key: createIdempotencyKey(),
      });
      setDraft(null);
      onNotice("saved");
      onChanged();
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
          onClick={() => setDraft(arabicCaption?.caption ?? "")}
          className="rounded-lg border border-border px-3 py-2 text-xs font-bold text-navy hover:bg-muted"
        >
          {t("editInlineCta")}
        </button>
      ) : (
        <>
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            dir="rtl"
            aria-label={t("editInlineCta")}
            rows={3}
            className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-navy focus:border-primary focus:outline-none"
          />
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={isSaving || !draft.trim()}
            className="rounded-lg bg-primary px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-primary/90 disabled:opacity-60"
          >
            {isSaving ? t("saving") : t("saveEditCta")}
          </button>
          <button
            type="button"
            onClick={() => setDraft(null)}
            className="rounded-lg border border-border px-3 py-2 text-xs font-bold text-navy hover:bg-muted"
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
  onChanged: () => void;
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
      onChanged();
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
          className="rounded-lg border border-action/40 px-3 py-2 text-xs font-bold text-action hover:bg-action/5"
        >
          {t("rewriteCta")}
        </button>
      ) : (
        <>
          <input
            type="text"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            aria-label={t("rewriteNotesLabel")}
            placeholder={t("rewriteNotesPlaceholder")}
            className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-navy focus:border-primary focus:outline-none"
          />
          <button
            type="button"
            onClick={() => void handleRewrite()}
            disabled={isRewriting || !notes.trim()}
            className="rounded-lg bg-action px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-action/90 disabled:opacity-60"
          >
            {isRewriting ? t("rewriting") : t("rewriteConfirmCta")}
          </button>
          <button
            type="button"
            onClick={() => setNotes(null)}
            className="rounded-lg border border-border px-3 py-2 text-xs font-bold text-navy hover:bg-muted"
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
  onChanged: () => void,
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
    onChanged();
  } catch {
    onError("approvalFailed");
  }
}
