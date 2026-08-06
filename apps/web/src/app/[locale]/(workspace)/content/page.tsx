import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ContentCycleEntry } from "@/features/content/cycle/components/content-cycle-entry";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "ContentCycle.metadata" });
  return {
    title: t("entryTitle"),
  };
}

export default async function ContentEntryPage() {
  return <ContentCycleEntry />;
}
