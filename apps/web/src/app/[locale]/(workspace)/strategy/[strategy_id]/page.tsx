'use client'

import { use } from 'react'
import { useTranslations } from 'next-intl'
import { useStrategy } from '@/features/strategy/hooks/use-strategy'
import { useStrategyProgress } from '@/features/strategy/hooks/use-strategy-progress'
import { StrategyProgress } from '@/features/strategy/components/strategy-progress'
import { getProgressEvents } from '@/features/strategy/lib/strategy-state'
import { toStrategyResource } from '@/lib/api/strategy'

type Props = {
  params: Promise<{ strategy_id: string }>
}

export default function StrategyWorkspacePage({ params }: Props) {
  const { strategy_id } = use(params)
  const tc = useTranslations('Common')
  const { strategy, loading, error } = useStrategy(strategy_id)
  const { status } = useStrategyProgress(strategy_id)

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
        <p className="text-sm text-destructive">{tc('loading')}</p>
      </div>
    )
  }

  const resource = toStrategyResource(strategy)
  const currentStatus = status ?? resource.status
  const progress = getProgressEvents(currentStatus, strategy_id)

  return <StrategyProgress status={currentStatus} progress={progress} />
}
