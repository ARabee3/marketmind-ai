'use client'

import { use, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import type {
  RetrievedKnowledgePack,
  StrategyPlan,
  StrategyResource,
} from '@marketmind/contracts'
import { StrategyReview } from '@/features/strategy/components/strategy-review'
import type { StrategyProfileSummary } from '@/features/strategy/lib/strategy-fixtures'
import { getCurrentJourney } from '@/lib/api/journey'
import {
  getStrategyRetrieval,
  getStrategyVersion,
  getStrategyVersions,
} from '@/lib/api/strategy'

type Props = {
  params: Promise<{ strategy_id: string; version: string }>
}

type HistoricalState = {
  plan: StrategyPlan
  resource: StrategyResource
  profile: StrategyProfileSummary | null
  retrieval: RetrievedKnowledgePack | null
}

export default function StrategyVersionPage({ params }: Props) {
  const { strategy_id, version } = use(params)
  const tc = useTranslations('Common')
  const [state, setState] = useState<HistoricalState | null>(null)
  const [error, setError] = useState(false)
  const versionNumber = Number(version)
  const invalidVersion =
    !Number.isInteger(versionNumber) || versionNumber < 1

  useEffect(() => {
    let cancelled = false
    if (invalidVersion) return

    Promise.all([
      getStrategyVersion(strategy_id, versionNumber),
      getStrategyVersions(strategy_id),
      getCurrentJourney().catch(() => null),
      getStrategyRetrieval(strategy_id).catch(() => null),
    ])
      .then(([plan, versions, journey, latestRetrieval]) => {
        if (cancelled) return
        const summary = versions.find((item) => item.version === versionNumber)
        const profileData =
          journey?.journey.state === 'discovery_confirmed'
            ? journey.journey.profile
            : null
        const profile =
          profileData && profileData.version === plan.profile_version.version
            ? {
                businessName: profileData.business_name,
                businessType: profileData.business_type,
                location: [profileData.city, profileData.area]
                  .filter(Boolean)
                  .join(', '),
                confirmedAt: profileData.confirmed_at,
                version: profileData.version,
              }
            : null
        setState({
          plan,
          profile,
          retrieval:
            latestRetrieval?.retrieval_run_id === plan.retrieval_run_id
              ? latestRetrieval
              : null,
          resource: {
            strategy_id,
            status: summary?.status ?? 'draft',
            brief: null,
            latest_plan: plan,
          },
        })
      })
      .catch(() => {
        if (!cancelled) setError(true)
      })

    return () => { cancelled = true }
  }, [invalidVersion, strategy_id, versionNumber])

  if (error || invalidVersion) {
    return (
      <div className="flex min-h-40 items-center justify-center">
        <p className="text-sm text-destructive">{tc('error')}</p>
      </div>
    )
  }

  if (!state) {
    return (
      <div className="flex min-h-40 items-center justify-center">
        <p className="text-sm text-muted-foreground">{tc('loading')}</p>
      </div>
    )
  }

  return (
    <StrategyReview
      profile={state.profile}
      resource={state.resource}
      currentVersionId={null}
      retrieval={state.retrieval}
      progress={[]}
      onRefresh={async () => undefined}
      readOnly
    />
  )
}
