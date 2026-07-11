'use client'

import { RequireAuth } from '@/features/auth/require-auth'
import { IntakeForm } from '@/features/discovery/components/intake-form'

export default function DiscoveryNewPage() {
  return (
    <RequireAuth>
      <div className="py-8">
        <IntakeForm />
      </div>
    </RequireAuth>
  )
}
