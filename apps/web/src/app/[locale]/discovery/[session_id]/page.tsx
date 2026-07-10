'use client'

import { use } from 'react'
import { RequireAuth } from '@/features/auth/require-auth'
import { ProgressTimeline } from '@/features/discovery/components/progress-timeline'

type Props = {
  params: Promise<{ locale: string; session_id: string }>
}

export default function DiscoverySessionPage({ params }: Props) {
  const { session_id } = use(params)

  return (
    <RequireAuth>
      <div className="py-8">
        <ProgressTimeline sessionId={session_id} />
      </div>
    </RequireAuth>
  )
}
