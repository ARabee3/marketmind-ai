import { useTranslations } from "next-intl";
import { isStrategyPlanV2 } from "@/features/strategy/lib/strategy-v2";
import type { ApprovedContentStrategy } from "../lib/content-cycle-state";

type Props = {
  readonly selectedWeek: number;
  readonly approved: ApprovedContentStrategy;
};

export function ApprovedStrategyHandoff({ selectedWeek, approved }: Props) {
  const t = useTranslations("ContentCycle.strategy");
  const plan = approved.plan;

  const isV2 = isStrategyPlanV2(plan);
  const v1 = isV2 ? null : plan;

  const weekItem = isV2
    ? plan.calendar_weeks.find((w) => w.week_number === selectedWeek)
    : v1?.content_strategy?.weeks?.find((w) => w.week_number === selectedWeek);

  const theme = isV2
    ? (weekItem && "focus" in weekItem ? weekItem.focus : null) ?? t("themeUnavailable")
    : (weekItem && "theme" in weekItem ? weekItem.theme : null) ?? t("themeUnavailable");
  const channels = isV2
    ? plan.channel_commitments
    : (v1?.selected_channels ?? []);
  const pillars = isV2 ? [] : (v1?.content_strategy?.pillars ?? []);
  const toneText = isV2 ? null : (v1?.tone?.text ?? null);
  const cadence = isV2 ? null : (v1?.content_strategy?.weekly_cadence ?? null);
  const capacity = approved.brief.team_capacity ?? t("notAvailable");
  const constraints = approved.brief.constraints ?? [];

  return (
    <section aria-label={t("label")} className="rounded-xl border border-border bg-surface p-5 space-y-4 shadow-sm">
      <div className="flex items-center justify-between border-b border-border pb-3">
        <h2 className="text-base font-bold text-navy">{t("title")}</h2>
        <span className="rounded bg-soft-teal px-2 py-1 text-xs font-semibold text-primary">
          v{approved.strategyVersion}
        </span>
      </div>

      <div className="space-y-3 text-sm">
        {/* Selected Week Theme */}
        <div className="space-y-1">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            {t("theme", { week: selectedWeek })}
          </p>
          <p className="font-semibold text-navy">
            <bdi>{theme}</bdi>
          </p>
        </div>

        {/* Channels */}
        <div className="space-y-1">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            {t("channels")}
          </p>
          {channels.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {channels.map((ch) => (
                <span
                  key={ch.channel}
                  className="rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium text-navy"
                >
                  <bdi>
                    {ch.role === "primary"
                      ? t("primaryChannel", { channel: ch.channel })
                      : t("supportingChannel", { channel: ch.channel })}
                  </bdi>
                </span>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">{t("notAvailable")}</p>
          )}
        </div>

        {/* Pillars & Tone */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              {t("pillars")}
            </p>
            {pillars.length > 0 ? (
              <ul className="list-disc list-inside text-xs text-navy space-y-0.5">
                {pillars.map((pillar, idx) => (
                  <li key={idx}>
                    <bdi>{typeof pillar === "string" ? pillar : pillar.text}</bdi>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground">{t("notAvailable")}</p>
            )}
          </div>

          <div className="space-y-1">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              {t("tone")}
            </p>
            <p className="text-xs text-navy font-medium">
              <bdi>{toneText ?? t("notAvailable")}</bdi>
            </p>
          </div>
        </div>

        {/* Language, Cadence, Capacity */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 pt-2 border-t border-border/60 text-xs">
          <div>
            <span className="text-muted-foreground">{t("language")}: </span>
            <span className="font-medium text-navy">{approved.brief.plan_language}</span>
          </div>
          <div>
            <span className="text-muted-foreground">{t("cadence")}: </span>
            <span className="font-medium text-navy">{cadence ?? t("notAvailable")}</span>
          </div>
          <div>
            <span className="text-muted-foreground">{t("capacity")}: </span>
            <span className="font-medium text-navy"><bdi>{capacity}</bdi></span>
          </div>
        </div>

        {/* Constraints */}
        <div className="pt-2 border-t border-border/60 text-xs space-y-1">
          <p className="font-semibold text-muted-foreground uppercase tracking-wider">
            {t("constraints")}
          </p>
          {constraints.length > 0 ? (
            <ul className="list-disc list-inside text-navy space-y-0.5">
              {constraints.map((c, idx) => (
                <li key={idx}>
                  <bdi>{c}</bdi>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground">{t("noConstraints")}</p>
          )}
        </div>

        {/* Technical Provenance Disclosure */}
        <details className="pt-2 border-t border-border/60 text-xs text-muted-foreground">
          <summary className="cursor-pointer rounded font-semibold text-navy hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action">
            {t("provenance")}
          </summary>
          <div className="mt-2 space-y-1 bg-background p-2.5 rounded-lg font-mono text-[11px] break-all">
            <p>
              {t("strategyVersionId")}: <bdi>{approved.strategyVersionId}</bdi>
            </p>
            <p>
              {t("decisionId")}: <bdi>{approved.strategyDecisionId}</bdi>
            </p>
            <p>
              {t("profileVersion", { version: approved.profileVersion })}:{" "}
              <bdi>{approved.profileVersionId}</bdi>
            </p>
          </div>
        </details>
      </div>
    </section>
  );
}
