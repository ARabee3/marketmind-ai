'use client'

import { use } from 'react'
import { RequireAuth } from '@/features/auth/require-auth'
import { DiscoverySession } from '@/features/discovery/components/discovery-session'

type Props = {
  params: Promise<{ locale: string; session_id: string }>
}

export default function DiscoverySessionPage({ params }: Props) {
  const { session_id } = use(params)

  return (
    <RequireAuth>
      <div>
        <DiscoverySession sessionId={session_id} />
      </div>
    </RequireAuth>
  )
}
