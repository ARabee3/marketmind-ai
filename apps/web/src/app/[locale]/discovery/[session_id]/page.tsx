import { cookies } from 'next/headers'
import { ProgressTimeline } from '@/features/discovery/components/progress-timeline'

type Props = {
  params: Promise<{ locale: string; session_id: string }>
}

export default async function DiscoverySessionPage({ params }: Props) {
  const { session_id } = await params
  
  // TODO: Replace with real auth implementation from #19
  const cookieStore = await cookies()
  const token = cookieStore.get('access_token')?.value || 'temp-dev-token'

  return (
    <div className="py-8">
      <ProgressTimeline sessionId={session_id} authToken={token} />
    </div>
  )
}
