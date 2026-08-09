'use client'

import { useEffect, useState, use } from 'react'
import { useTranslations } from 'next-intl'
import { useStrategy } from '@/features/strategy/hooks/use-strategy'
import { useStrategyProgress } from '@/features/strategy/hooks/use-strategy-progress'
import { StrategyProgress } from '@/features/strategy/components/strategy-progress'
import { StrategyReview } from '@/features/strategy/components/strategy-review'
import {
  getStrategyProgress,
  getStrategyRetrieval,
  toStrategyResource,
} from '@/lib/api/strategy'
import { getCurrentJourney } from '@/lib/api/journey'
import { useStrategyActions } from '@/features/strategy/hooks/use-strategy-actions'
import type { StrategyProfileSummary } from '@/features/strategy/lib/strategy-fixtures'
import type {
  RetrievedKnowledgePack,
  StrategyProgressEvent,
} from '@marketmind/contracts'

type Props = {
  params: Promise<{ strategy_id: string }>
}

export default function StrategyWorkspacePage({ params }: Props) {
  const { strategy_id } = use(params)
  const tc = useTranslations('Common')
  const { strategy, loading, error, refresh } = useStrategy(strategy_id)
  const { status, progress } = useStrategyProgress(strategy_id)
  const {
    retry,
    pending: retryPending,
    error: retryError,
  } = useStrategyActions()
  const [profile, setProfile] = useState<StrategyProfileSummary | null>(null)
  const [retrieval, setRetrieval] = useState<RetrievedKnowledgePack | null>(
    null,
  )
  const [retrievalLoaded, setRetrievalLoaded] = useState(false)

  const resource = strategy ? toStrategyResource(strategy) : null
  const currentStatus = status ?? resource?.status ?? null
  const isApproved = currentStatus === 'approved'

  useEffect(() => {
    if (!isApproved) return
    let cancelled = false
    Promise.all([
      getCurrentJourney(),
      getStrategyRetrieval(strategy_id).catch(() => null),
    ])
      .then(([journey, retrievalPack]) => {
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
        setRetrievalLoaded(true)
      })
      .catch(() => {
        if (!cancelled) setRetrievalLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [isApproved, strategy_id])

  if (loading || (isApproved && !retrievalLoaded)) {
    return (
      <div className="flex min-h-40 items-center justify-center">
        <p className="text-sm text-muted-foreground">{tc('loading')}</p>
      </div>
    )
  }

  if (error || !strategy || !resource) {
    return (
      <div className="flex min-h-40 items-center justify-center">
        <p className="text-sm text-destructive">{tc('error')}</p>
      </div>
    )
  }

  async function handleRetry() {
    const result = await retry(strategy_id)
    if (result) window.location.reload()
  }

  async function refreshApproved() {
    const [, , retrievalPack] = await Promise.all([
      refresh(),
      getStrategyProgress(strategy_id).catch(
        () => [] as StrategyProgressEvent[],
      ),
      getStrategyRetrieval(strategy_id).catch(() => null),
    ])
    setRetrieval(retrievalPack)
    if (currentStatus === 'approved') {
      const journey = await getCurrentJourney().catch(() => null)
      if (
        journey?.journey.state === 'discovery_confirmed' &&
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
    }
  }

  if (isApproved) {
    return (
      <StrategyReview
        profile={profile}
        resource={resource}
        currentVersionId={strategy.currentVersionId}
        retrieval={retrieval}
        progress={progress}
        onRefresh={refreshApproved}
      />
    )
  }

  return (
    <StrategyProgress
      status={currentStatus ?? resource.status}
      progress={progress}
      reviewHref={`/strategy/${strategy_id}/review`}
      onRetry={handleRetry}
      retryPending={retryPending}
      actionError={retryError}
    />
  )
}
