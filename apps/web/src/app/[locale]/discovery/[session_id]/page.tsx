import { DiscoverySession } from '@/features/discovery/components/discovery-session'

type Props = {
  params: Promise<{ locale: string; session_id: string }>
}

export default async function DiscoverySessionPage({ params }: Props) {
  const { session_id } = await params

  // Issue #19 owns authentication. The access token lives in memory and is
  // passed here once auth is wired; until then the component renders without a
  // token and the API client sends no Authorization header.
  return (
    <div>
      <DiscoverySession sessionId={session_id} />
    </div>
  )
}
