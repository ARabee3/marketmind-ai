import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import { ContentV2Studio } from "@/features/content/v2/content-v2-studio";

type StudioPageProps = {
  readonly params: Promise<{ locale: string; cycle_id: string }>;
};

export async function generateMetadata({
  params,
}: StudioPageProps): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "ContentV2.metadata" });
  return { title: t("title") };
}

export default async function StudioPage({ params }: StudioPageProps) {
  const { cycle_id } = await params;
  return (
    <main className="mx-auto w-full max-w-[1200px] px-4 py-6">
      <ContentV2Studio cycleId={cycle_id} />
    </main>
  );
}
