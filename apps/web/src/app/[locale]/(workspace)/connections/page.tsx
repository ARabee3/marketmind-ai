import { getTranslations } from "next-intl/server";

import { ConnectionsPage } from "@/features/connections/components/connections-page";

export async function generateMetadata() {
  const t = await getTranslations("Connections");
  return { title: t("metadata.title") };
}

export default function ConnectionsRoutePage() {
  return <ConnectionsPage />;
}
