'use client'

import { use } from 'react'
import { useTranslations } from 'next-intl'
import { useStrategy } from '@/features/strategy/hooks/use-strategy'
import { useStrategyProgress } from '@/features/strategy/hooks/use-strategy-progress'
import { StrategyProgress } from '@/features/strategy/components/strategy-progress'
import { toStrategyResource } from '@/lib/api/strategy'
import { useStrategyActions } from '@/features/strategy/hooks/use-strategy-actions'

type Props = {
  params: Promise<{ strategy_id: string }>
}

export default function StrategyWorkspacePage({ params }: Props) {
  const { strategy_id } = use(params)
  const tc = useTranslations('Common')
  const { strategy, loading, error } = useStrategy(strategy_id)
  const { status, progress } = useStrategyProgress(strategy_id)
  const {
    retry,
    pending: retryPending,
    error: retryError,
  } = useStrategyActions()

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
  const currentStatus = status ?? resource.status

  async function handleRetry() {
    const result = await retry(strategy_id)
    if (result) window.location.reload()
  }

  return (
    <StrategyProgress
      status={currentStatus}
      progress={progress}
      reviewHref={`/strategy/${strategy_id}/review`}
      onRetry={handleRetry}
      retryPending={retryPending}
      actionError={retryError}
    />
  )
}
