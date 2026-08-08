'use client'

import { use } from 'react'
import { useTranslations } from 'next-intl'
import { isStrategyPlanV2 } from '@marketmind/contracts'
import { useStrategy } from '@/features/strategy/hooks/use-strategy'
import { StrategyAdvice } from '@/features/strategy/components/strategy-advice'
import { StrategyReview } from '@/features/strategy/components/strategy-review'
import { toStrategyResource } from '@/lib/api/strategy'

type Props = {
  params: Promise<{ strategy_id: string }>
}

export default function StrategyAdvicePage({ params }: Props) {
  const { strategy_id } = use(params)
  const tc = useTranslations('Common')
  const { strategy, loading, error } = useStrategy(strategy_id)

  if (loading) {
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

  const resource = toStrategyResource(strategy)
  const plan = resource.latest_plan

  if (!plan || !isStrategyPlanV2(plan)) {
    // Legacy v1 plans have no separate owner-advice surface; fall back to the
    // full review so the page never renders empty.
    return (
      <StrategyReview
        profile={null}
        resource={resource}
        currentVersionId={strategy.currentVersionId}
        retrieval={null}
        progress={[]}
        onRefresh={async () => undefined}
        readOnly
      />
    )
  }

  return <StrategyAdvice strategyId={strategy_id} plan={plan} />
}
