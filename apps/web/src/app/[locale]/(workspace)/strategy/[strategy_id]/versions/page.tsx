'use client'

import { useEffect, useState } from 'react'
import { use } from 'react'
import { useTranslations } from 'next-intl'
import { getStrategyVersions } from '@/lib/api/strategy'
import type { StrategyVersionSummary } from '@marketmind/contracts'
import { StrategyVersionHistory } from '@/features/strategy/components/strategy-version-history'

type Props = {
  params: Promise<{ strategy_id: string }>
}

export default function StrategyVersionsPage({ params }: Props) {
  const { strategy_id } = use(params)
  const tc = useTranslations('Common')
  const [versions, setVersions] = useState<StrategyVersionSummary[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    getStrategyVersions(strategy_id)
      .then((data) => { if (!cancelled) { setVersions(data); setLoading(false) } })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err && typeof err === 'object' && 'message' in err
            ? (err as { message: string }).message
            : 'Failed to load versions')
          setLoading(false)
        }
      })
    return () => { cancelled = true }
  }, [strategy_id])

  if (loading) {
    return (
      <div className="flex min-h-40 items-center justify-center">
        <p className="text-sm text-muted-foreground">{tc('loading')}</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex min-h-40 items-center justify-center">
        <p className="text-sm text-destructive">{tc('error')}</p>
      </div>
    )
  }

  return <StrategyVersionHistory versions={versions ?? []} />
}
