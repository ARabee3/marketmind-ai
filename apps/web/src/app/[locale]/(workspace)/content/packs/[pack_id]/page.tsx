import { ContentPackReviewGate } from "@/features/content/v2/content-pack-review-gate";

type PageProps = {
  params: Promise<{ pack_id: string }>;
};

export default async function ContentPackReviewPage({ params }: PageProps) {
  const { pack_id } = await params;

  return <ContentPackReviewGate packId={pack_id} />;
}
