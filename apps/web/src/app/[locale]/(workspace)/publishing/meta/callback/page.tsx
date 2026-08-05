import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

export default async function PublishingMetaCallbackPage() {
  const t = await getTranslations("Publishing");
  return (
    <section className="mx-auto grid max-w-xl gap-4 rounded-xl border border-warning/25 bg-surface p-6 text-center shadow-elevated">
      <h1 className="text-2xl font-bold text-navy">
        {t("readiness.connectUnavailable")}
      </h1>
      <p className="text-sm leading-6 text-muted-foreground">
        {t("target.connectUnavailable")}
      </p>
      <Link
        href="/publishing"
        className="mx-auto inline-flex min-h-10 items-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:ring-3 focus-visible:ring-ring/40"
      >
        {t("header.title")}
      </Link>
    </section>
  );
}
