import { useFormatter, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import type { ContentPack, ContentProgressEvent } from "@marketmind/contracts";

type Props = {
  readonly pack: ContentPack | null;
  readonly events: readonly ContentProgressEvent[];
  readonly isPolling?: boolean;
  readonly errorKey?: string | null;
  readonly isRetrying?: boolean;
  readonly onRetry?: () => Promise<void>;
  readonly onRefresh?: () => void;
  readonly showActions?: boolean;
};

export function ContentGenerationProgress({
  pack,
  events,
  isPolling = false,
  errorKey = null,
  isRetrying = false,
  onRetry,
  onRefresh,
  showActions = true,
}: Props) {
  const t = useTranslations("ContentCycle.progress");
  const tActions = useTranslations("ContentCycle.actions");
  const format = useFormatter();

  const formatKey = (prefix: string, key: string) =>
    t(`${prefix}.${key}` as unknown as Parameters<typeof t>[0]);

  if (!pack) {
    return null;
  }

  const isFailed = pack.status === "failed";
  const isReadyForReview = ["draft", "partially_approved", "approved"].includes(
    pack.status,
  );
  const statusKey = pack.status === "partially_approved" ? "partiallyApproved" : pack.status;

  return (
    <section aria-label={t("label")} className="rounded-xl border border-border bg-surface p-5 space-y-4 shadow-sm">
      <div className="flex items-center justify-between border-b border-border pb-3">
        <div>
          <h2 className="text-base font-bold text-navy">{t("title")}</h2>
          <p className="text-xs text-muted-foreground capitalize font-medium">
            <span aria-live="polite">{formatKey("statuses", statusKey)}</span>
          </p>
        </div>
        {isPolling && (
          <span className="inline-flex items-center gap-1.5 text-xs text-action font-medium">
            <span className="size-2 rounded-full bg-action animate-ping motion-reduce:animate-none" />
            {t("stages.generating")}
          </span>
        )}
      </div>

      {errorKey && (
        <div role="alert" aria-live="polite" className="rounded-lg border border-danger/30 bg-danger/10 p-3 text-xs text-danger flex items-center justify-between">
          <span>{t("loadError")}</span>
          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              className="rounded px-1 font-bold underline hover:opacity-80 focus-visible:ring-2 focus-visible:ring-action"
            >
              {tActions("refresh")}
            </button>
          )}
        </div>
      )}

      {/* Progress Timeline Events */}
      {events.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t("label")}
          </p>
          <ol className="space-y-2 border-s-2 border-border ps-3 ms-1 text-xs">
            {events.map((ev) => (
              <li key={`${ev.content_pack_id}-${ev.seq}`} className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-navy">
                    {formatKey("stages", ev.stage)}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {format.dateTime(new Date(ev.created_at), {
                      timeZone: "Africa/Cairo",
                      timeStyle: "short",
                    })}
                  </span>
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Failure & Retry State */}
      {isFailed && (
        <div className="rounded-lg border border-danger/40 bg-danger/5 p-4 space-y-3">
          <p className="text-xs text-danger font-medium">
            {pack.retry_eligible ? t("retryableBody") : t("nonRetryableBody")}
          </p>

          {showActions && pack.retry_eligible && onRetry && (
            <button
              type="button"
              onClick={onRetry}
              disabled={isRetrying}
              className="rounded-lg bg-danger px-3.5 py-2 text-xs font-bold text-white transition-colors hover:bg-danger/90 focus-visible:ring-2 focus-visible:ring-danger disabled:opacity-50"
            >
              {isRetrying ? tActions("retryingGeneration") : tActions("retryGeneration")}
            </button>
          )}
        </div>
      )}

      {/* Ready / Review State */}
      {isReadyForReview && (
        <div className="rounded-lg border border-primary/30 bg-soft-teal p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <p className="text-xs font-bold text-navy">
              {formatKey("statuses", statusKey)}
            </p>
            <p className="text-xs text-muted-foreground">
              {t("itemCount", { count: pack.item_ids.length })}
            </p>
          </div>

          {showActions && (
            <Link
              href={`/content/packs/${pack.id}`}
              className="inline-flex items-center justify-center rounded-lg bg-action px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-action/90 focus-visible:ring-2 focus-visible:ring-action shrink-0"
            >
              {tActions("reviewPack")}
            </Link>
          )}
        </div>
      )}
    </section>
  );
}
