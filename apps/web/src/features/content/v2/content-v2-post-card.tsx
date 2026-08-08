import { useTranslations } from "next-intl";
import type { ContentPostPlanV2 } from "@marketmind/contracts";
import { cn } from "@/lib/utils";

const CHANNEL_LABELS: Record<string, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  tiktok: "TikTok",
  google_business_profile: "Google Business Profile",
};

const FORMAT_LABELS: Record<string, string> = {
  static_image_post: "Static image post",
  short_video_script: "Short video script",
  carousel_brief: "Carousel brief",
  text_post: "Text post",
};

type PostCardProps = {
  readonly plan: ContentPostPlanV2;
  readonly ctaLabel: string | null;
  readonly mediaCount: number;
  readonly onEdit?: () => void;
};

export function ContentV2PostCard({
  plan,
  ctaLabel,
  mediaCount,
  onEdit,
}: PostCardProps) {
  const t = useTranslations("ContentV2.postCard");
  const tStudio = useTranslations("ContentV2.studio.generationState");

  return (
    <article
      className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 shadow-sm"
      aria-label={t("postLabel", { position: plan.position })}
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-sm font-bold text-navy">
          {t("postLabel", { position: plan.position })}
        </h3>
        <span
          className={cn(
            "rounded-full px-2.5 py-0.5 text-[11px] font-bold",
            plan.plan_state === "ready" && "bg-primary/10 text-primary",
            plan.plan_state === "generating" && "bg-warning/10 text-warning",
            plan.plan_state === "failed" && "bg-danger/10 text-danger",
            plan.plan_state === "planned" && "bg-muted text-muted-foreground",
          )}
        >
          {tStudio(plan.plan_state)}
        </span>
      </div>

      <p className="text-xs leading-relaxed text-navy">{plan.purpose}</p>

      {plan.intended_audience && (
        <dl className="grid grid-cols-1 gap-2 text-xs">
          <div>
            <dt className="font-semibold text-muted-foreground">
              {t("audienceLabel")}
            </dt>
            <dd className="mt-0.5 text-navy">{plan.intended_audience}</dd>
          </div>
        </dl>
      )}

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
        <div>
          <dt className="font-semibold text-muted-foreground">
            {t("channelLabel")}
          </dt>
          <dd className="mt-0.5 font-semibold text-navy">
            {CHANNEL_LABELS[plan.channel] ?? plan.channel}
          </dd>
        </div>
        <div>
          <dt className="font-semibold text-muted-foreground">
            {t("formatLabel")}
          </dt>
          <dd className="mt-0.5 font-semibold text-navy">
            {FORMAT_LABELS[plan.format] ?? plan.format}
          </dd>
        </div>
        <div>
          <dt className="font-semibold text-muted-foreground">
            {t("ctaLabel")}
          </dt>
          <dd className="mt-0.5 text-navy">{ctaLabel ?? t("noCta")}</dd>
        </div>
        <div>
          <dt className="font-semibold text-muted-foreground">
            {t("mediaLabel")}
          </dt>
          <dd className="mt-0.5 text-navy">{mediaCount}</dd>
        </div>
      </dl>

      {plan.visual_direction && (
        <p className="text-xs text-muted-foreground">
          <span className="font-semibold">{t("visualLabel")}: </span>
          {plan.visual_direction}
        </p>
      )}

      {onEdit && (
        <button
          type="button"
          onClick={onEdit}
          className="mt-auto self-start rounded-lg border border-border px-3 py-1.5 text-xs font-bold text-primary hover:bg-primary/5"
        >
          {t("editCta")}
        </button>
      )}
    </article>
  );
}
