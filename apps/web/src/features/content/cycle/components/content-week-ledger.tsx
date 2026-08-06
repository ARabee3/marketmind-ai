import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import type { ContentWeekSlot } from "../lib/content-cycle-state";

type Props = {
  readonly slots: readonly ContentWeekSlot[];
};

export function ContentWeekLedger({ slots }: Props) {
  const t = useTranslations("ContentCycle.ledger");
  const tProgress = useTranslations("ContentCycle.progress");
  const selectedLinkRef = useRef<HTMLAnchorElement>(null);
  const selectedWeek = slots.find((slot) => slot.isSelected)?.weekNumber ?? null;

  const formatPackStatus = (status: string) => {
    const statusKey = status === "partially_approved" ? "partiallyApproved" : status;
    return tProgress(
      `statuses.${statusKey}` as unknown as Parameters<typeof tProgress>[0],
    );
  };

  useEffect(() => {
    if (typeof selectedLinkRef.current?.scrollIntoView === "function") {
      selectedLinkRef.current.scrollIntoView({
        behavior: "auto",
        block: "nearest",
        inline: "center",
      });
    }
  }, [selectedWeek]);

  return (
    <section aria-label={t("label")} className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {t("label")}
        </h2>
      </div>

      <nav aria-label={t("label")} className="overflow-x-auto pb-2">
        <ol className="flex min-w-max items-center gap-2">
          {slots.map((slot) => {
            const isSelected = slot.isSelected;
            const isCurrent = slot.timing === "current";
            const isNext = slot.timing === "next";

            return (
              <li key={slot.weekNumber} className="shrink-0">
                <Link
                  href={slot.href}
                  ref={isSelected ? selectedLinkRef : undefined}
                  aria-current={isSelected ? "page" : undefined}
                  className={cn(
                    "flex w-36 flex-col justify-between rounded-xl border p-3 text-start text-xs transition-[border-color,background-color,box-shadow] focus-visible:ring-2 focus-visible:ring-action",
                    isSelected
                      ? "border-primary bg-surface shadow-md ring-1 ring-primary"
                      : "border-border bg-surface/80 hover:border-primary/50 hover:bg-surface",
                  )}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="font-bold text-navy">
                      {t("week", { number: slot.weekNumber })}
                    </span>
                    <div className="flex items-center gap-1">
                      {isCurrent && (
                        <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold text-primary">
                          {t("current")}
                        </span>
                      )}
                      {isNext && (
                        <span className="rounded bg-action/10 px-1.5 py-0.5 text-[10px] font-bold text-action">
                          {t("next")}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="mt-2 space-y-1">
                    {/* Context Status */}
                    <div className="text-[11px] font-medium">
                      {slot.context.kind === "owner_confirmed" && (
                        <span className="text-primary font-semibold">
                          ✓ {t("ownerConfirmed")}
                        </span>
                      )}
                      {slot.context.kind === "system_defaulted" && (
                        <span className="text-warning font-semibold">
                          ⚠ {t("systemDefaulted")}
                        </span>
                      )}
                      {slot.context.kind === "not_saved" && (
                        <span className="text-muted-foreground">
                          {t("contextOpen")}
                        </span>
                      )}
                    </div>

                    {/* Pack Status */}
                    <div className="text-[10px] text-muted-foreground">
                      {slot.pack.kind === "known" && (
                        <span className="font-medium text-navy">
                          {formatPackStatus(slot.pack.status)}
                        </span>
                      )}
                      {slot.pack.kind === "history_unavailable" && (
                        <span>{t("packHistoryUnavailable")}</span>
                      )}
                      {slot.pack.kind === "not_eligible_yet" && (
                        <span>{t("notEligibleYet")}</span>
                      )}
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ol>
      </nav>
    </section>
  );
}
