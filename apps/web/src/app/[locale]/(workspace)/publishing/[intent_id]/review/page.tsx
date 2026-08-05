import { PublishingWorkspace } from "@/features/publishing/components/publishing-workspace";

export default async function PublishingReviewPage({
  params,
}: {
  readonly params: Promise<{ intent_id: string }>;
}) {
  const { intent_id: intentId } = await params;
  return <PublishingWorkspace intentId={intentId} />;
}
