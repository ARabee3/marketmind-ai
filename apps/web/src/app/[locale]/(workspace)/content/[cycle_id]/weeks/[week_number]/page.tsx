import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ContentCycleWorkspace } from "@/features/content/cycle/components/content-cycle-workspace";

type Props = {
  params: Promise<{
    locale: string;
    cycle_id: string;
    week_number: string;
  }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, week_number } = await params;
  const parsedWeek = parseInt(week_number, 10);
  if (isNaN(parsedWeek) || parsedWeek < 1 || parsedWeek > 12) {
    return {};
  }
  const t = await getTranslations({ locale, namespace: "ContentCycle.metadata" });
  return {
    title: t("weekTitle", { week: parsedWeek }),
  };
}

export default async function ContentWeekPage({ params }: Props) {
  const { cycle_id, week_number } = await params;
  const parsedWeek = parseInt(week_number, 10);

  // Strictly validate week_number: 1..12 integer only.
  if (
    isNaN(parsedWeek) ||
    String(parsedWeek) !== week_number ||
    parsedWeek < 1 ||
    parsedWeek > 12
  ) {
    notFound();
  }

  return (
    <ContentCycleWorkspace cycleId={cycle_id} weekNumber={parsedWeek} />
  );
}
