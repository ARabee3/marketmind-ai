import { getTranslations } from "next-intl/server";
import { MetaConnectionStart } from "@/features/publishing/components/meta-connection-start";

export async function generateMetadata() {
  const t = await getTranslations("Publishing");
  return { title: t("metadata.title") };
}

export default function PublishingMetaConnectPage() {
  return <MetaConnectionStart />;
}
