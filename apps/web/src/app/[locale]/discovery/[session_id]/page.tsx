import { ProgressTimeline } from '@/features/discovery/components/progress-timeline'

type Props = {
  params: Promise<{ locale: string; session_id: string }>
}

export default async function DiscoverySessionPage({ params }: Props) {
  const { session_id } = await params

  return (
    <div className="py-8">
      <ProgressTimeline sessionId={session_id} />
    </div>
  )
}
