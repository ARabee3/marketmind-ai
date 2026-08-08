import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { PublishingMetaCallbackResult } from "@/features/publishing/components/meta-connection-result";

export async function generateMetadata() {
  const t = await getTranslations("Publishing");
  return { title: t("metadata.title") };
}

/**
 * Return landing page for the API-owned Meta callback (issue #175).
 *
 * The API redirects here with ONLY a sanitized result code (`meta_result`)
 * and a connection id (`meta_connection`) — never a token, code, ciphertext,
 * or credential reference. The query is read client-side (same pattern as the
 * publishing workspace) and the journey continues: choose accounts → ready.
 */
export default function PublishingMetaCallbackPage() {
  return (
    <Suspense fallback={null}>
      <PublishingMetaCallbackResult />
    </Suspense>
  );
}
