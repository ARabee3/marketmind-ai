import { getTranslations } from "next-intl/server";
import { PublishingWorkspace } from "@/features/publishing/components/publishing-workspace";

export async function generateMetadata() {
  const t = await getTranslations("Publishing");
  return { title: t("metadata.title") };
}

export default async function PublishingIntentPage({
  params,
}: {
  readonly params: Promise<{ intent_id: string }>;
}) {
  const { intent_id: intentId } = await params;
  return <PublishingWorkspace intentId={intentId} />;
}
