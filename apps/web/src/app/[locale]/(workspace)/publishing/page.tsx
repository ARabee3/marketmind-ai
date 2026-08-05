import { getTranslations } from "next-intl/server";
import { PublishingWorkspace } from "@/features/publishing/components/publishing-workspace";

export async function generateMetadata() {
  const t = await getTranslations("Publishing");
  return { title: t("metadata.title") };
}

export default function PublishingPage() {
  return <PublishingWorkspace />;
}
