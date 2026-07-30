'use client'

import { useEffect, useState } from 'react'
import { use } from 'react'
import { useTranslations } from 'next-intl'
import { useStrategy } from '@/features/strategy/hooks/use-strategy'
import { StrategyReview } from '@/features/strategy/components/strategy-review'
import { toStrategyResource } from '@/lib/api/strategy'
import { getCurrentJourney } from '@/lib/api/journey'
import type { StrategyProfileSummary } from '@/features/strategy/lib/strategy-fixtures'

type Props = {
  params: Promise<{ strategy_id: string }>
}

export default function StrategyReviewPage({ params }: Props) {
  const { strategy_id } = use(params)
  const tc = useTranslations('Common')
  const { strategy, loading, error } = useStrategy(strategy_id)
  const [profile, setProfile] = useState<StrategyProfileSummary | null>(null)
  const [profileLoaded, setProfileLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    getCurrentJourney()
      .then((journey) => {
        if (cancelled) return
        if (journey.journey.state === 'discovery_confirmed' && journey.journey.profile) {
          const p = journey.journey.profile
          setProfile({
            businessName: p.business_name,
            businessType: p.business_type,
            location: [p.city, p.area].filter(Boolean).join(', '),
            confirmedAt: p.confirmed_at,
            version: p.version,
          })
        }
        setProfileLoaded(true)
      })
      .catch(() => { if (!cancelled) setProfileLoaded(true) })
    return () => { cancelled = true }
  }, [])

  if (loading || !profileLoaded) {
    return (
      <div className="flex min-h-40 items-center justify-center">
        <p className="text-sm text-muted-foreground">{tc('loading')}</p>
      </div>
    )
  }

  if (error || !strategy) {
    return (
      <div className="flex min-h-40 items-center justify-center">
        <p className="text-sm text-destructive">{tc('error')}</p>
      </div>
    )
  }

  return (
    <StrategyReview
      profile={profile}
      resource={toStrategyResource(strategy)}
    />
  )
}
