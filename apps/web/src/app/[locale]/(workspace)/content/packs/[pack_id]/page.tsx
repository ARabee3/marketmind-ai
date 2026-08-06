import { ContentReviewWorkspace } from '@/features/content/review/components/ContentReviewWorkspace'

type PageProps = {
  params: Promise<{ pack_id: string }>
}

export default async function ContentPackReviewPage({ params }: PageProps) {
  const { pack_id } = await params

  return <ContentReviewWorkspace packId={pack_id} />
}
