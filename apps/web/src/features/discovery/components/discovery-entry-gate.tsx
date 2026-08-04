'use client'

import { useEffect, useState } from 'react'
import { useRouter } from '@/i18n/navigation'
import { getCurrentJourney } from '@/lib/api/journey'
import { IntakeForm } from './intake-form'

type GatePhase = 'checking' | 'intake'

export function DiscoveryEntryGate() {
  const router = useRouter()
  const [phase, setPhase] = useState<GatePhase>('checking')

  useEffect(() => {
    let cancelled = false

    getCurrentJourney()
      .then((response) => {
        if (cancelled) return
        switch (response.journey.state) {
          case 'discovery_confirmed':
          case 'discovery_active':
          case 'discovery_summary_review': {
            const sessionId = response.journey.discovery?.session_id
            router.replace(`/discovery/${sessionId}`)
            return
          }
          default:
            setPhase('intake')
        }
      })
      .catch(() => {
        if (!cancelled) setPhase('intake')
      })

    return () => {
      cancelled = true
    }
  }, [router])

  if (phase === 'checking') {
    return null
  }

  return <IntakeForm />
}