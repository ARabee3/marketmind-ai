import { useFormatter, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import type { ApprovedContentStrategy } from "../lib/content-cycle-state";

type Props = {
  readonly selectedWeek?: number;
  readonly approved: ApprovedContentStrategy;
};

export function CycleThesisHeader({ selectedWeek = 1, approved }: Props) {
  const t = useTranslations("ContentCycle.header");
  const format = useFormatter();

  return (
    <header className="rounded-xl border border-border bg-surface p-5 shadow-sm">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-primary">
            <span>{t("eyebrow")}</span>
            <span>·</span>
            <span>{t("weekOfTotal", { week: selectedWeek, total: 12 })}</span>
            <span>·</span>
            <span className="text-muted-foreground">{t("timezone")}</span>
          </div>
          <h1 className="text-xl font-bold tracking-tight text-navy sm:text-2xl">
            {t("title")}
          </h1>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>

        <div className="flex flex-wrap items-center gap-3 shrink-0">
          <div className="rounded-lg border border-border/80 bg-background px-3 py-2 text-xs">
            <p className="font-medium text-navy">
              {t("strategyVersion", { version: approved.strategyVersion })}
            </p>
            <p className="text-muted-foreground">
              {t("approvedAt", {
                date: format.dateTime(new Date(approved.decisionAt), {
                  dateStyle: "medium",
                  timeZone: "Africa/Cairo",
                }),
              })}
            </p>
          </div>

          <Link
            href={`/strategy/${approved.strategyId}/review`}
            className="inline-flex items-center justify-center rounded-lg border border-border bg-surface px-3 py-2 text-xs font-medium text-navy transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-action"
          >
            {t("viewStrategy")}
          </Link>
        </div>
      </div>
    </header>
  );
}
