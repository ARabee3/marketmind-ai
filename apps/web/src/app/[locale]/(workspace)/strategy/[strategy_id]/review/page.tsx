'use client'

import { useEffect, useState } from 'react'
import { use } from 'react'
import { useTranslations } from 'next-intl'
import { useWallet } from '@/features/billing/wallet-context'
import { useStrategy } from '@/features/strategy/hooks/use-strategy'
import { StrategyReview } from '@/features/strategy/components/strategy-review'
import {
  getStrategyProgress,
  getStrategyRetrieval,
  toStrategyResource,
} from '@/lib/api/strategy'
import { getCurrentJourney } from '@/lib/api/journey'
import type { StrategyProfileSummary } from '@/features/strategy/lib/strategy-fixtures'
import type {
  RetrievedKnowledgePack,
  StrategyProgressEvent,
} from '@marketmind/contracts'

type Props = {
  params: Promise<{ strategy_id: string }>
}

export default function StrategyReviewPage({ params }: Props) {
  const { strategy_id } = use(params)
  const tc = useTranslations('Common')
  const { strategy, loading, error, refresh } = useStrategy(strategy_id)
  const { refresh: refreshWallet } = useWallet()
  const [profile, setProfile] = useState<StrategyProfileSummary | null>(null)
  const [retrieval, setRetrieval] = useState<RetrievedKnowledgePack | null>(
    null,
  )
  const [progress, setProgress] = useState<readonly StrategyProgressEvent[]>([])
  const [profileLoaded, setProfileLoaded] = useState(false)

  useEffect(() => {
    void refreshWallet()
  }, [refreshWallet, strategy_id])

  useEffect(() => {
    let cancelled = false
    Promise.all([
      getCurrentJourney(),
      getStrategyRetrieval(strategy_id).catch(() => null),
      getStrategyProgress(strategy_id).catch(() => []),
    ])
      .then(([journey, retrievalPack, progressEvents]) => {
        if (cancelled) return
        if (
          journey.journey.state === 'discovery_confirmed' &&
          journey.journey.profile
        ) {
          const p = journey.journey.profile
          setProfile({
            businessName: p.business_name,
            businessType: p.business_type,
            location: [p.city, p.area].filter(Boolean).join(', '),
            confirmedAt: p.confirmed_at,
            version: p.version,
          })
        }
        setRetrieval(retrievalPack)
        setProgress(progressEvents)
        setProfileLoaded(true)
      })
      .catch(() => {
        if (!cancelled) setProfileLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [strategy_id])

  async function refreshReview() {
    const [, progressEvents, retrievalPack] = await Promise.all([
      refresh(),
      getStrategyProgress(strategy_id).catch(() => []),
      getStrategyRetrieval(strategy_id).catch(() => null),
    ])
    setProgress(progressEvents)
    setRetrieval(retrievalPack)
  }

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
      currentVersionId={strategy.currentVersionId}
      retrieval={retrieval}
      progress={progress}
      onRefresh={refreshReview}
    />
  )
}
