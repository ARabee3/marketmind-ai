'use client'

import { useCallback, useRef, useState } from 'react'
import {
  createStrategy as apiCreateStrategy,
  upsertBrief as apiUpsertBrief,
  generateStrategy as apiGenerateStrategy,
  submitDecision as apiSubmitDecision,
  retryStrategy as apiRetryStrategy,
  type UpsertBriefPayload,
  type OwnerDecisionPayload,
  type StrategyApiResponse,
  type BriefApiResponse,
} from '@/lib/api/strategy'

export interface UseStrategyActionsResult {
  create: (businessId: string) => Promise<StrategyApiResponse | null>
  saveBrief: (strategyId: string, payload: UpsertBriefPayload) => Promise<BriefApiResponse | null>
  generate: (strategyId: string) => Promise<{ status: string; correlationId: string } | null>
  decide: (strategyId: string, payload: OwnerDecisionPayload) => Promise<{ decision: unknown; nextStatus?: string } | null>
  retry: (strategyId: string) => Promise<{ status: string } | null>
  pending: boolean
  error: string | null
}

export function useStrategyActions(): UseStrategyActionsResult {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pendingRef = useRef(false)

  const wrap = useCallback(
    <T,>(fn: () => Promise<T>): Promise<T | null> => {
      if (pendingRef.current) return Promise.resolve(null)
      pendingRef.current = true
      setPending(true)
      setError(null)
      return fn()
        .catch((err: unknown) => {
          const message = err && typeof err === 'object' && 'message' in err
            ? (err as { message: string }).message
            : 'Operation failed'
          setError(message)
          return null
        })
        .finally(() => {
          pendingRef.current = false
          setPending(false)
        })
    },
    [],
  )

  const create = useCallback(
    (businessId: string) => wrap(() => apiCreateStrategy(businessId)),
    [wrap],
  )

  const saveBrief = useCallback(
    (strategyId: string, payload: UpsertBriefPayload) => wrap(() => apiUpsertBrief(strategyId, payload)),
    [wrap],
  )

  const generate = useCallback(
    (strategyId: string) => wrap(() => apiGenerateStrategy(strategyId)),
    [wrap],
  )

  const decide = useCallback(
    (strategyId: string, payload: OwnerDecisionPayload) => wrap(() => apiSubmitDecision(strategyId, payload)),
    [wrap],
  )

  const retry = useCallback(
    (strategyId: string) => wrap(() => apiRetryStrategy(strategyId)),
    [wrap],
  )

  return { create, saveBrief, generate, decide, retry, pending, error }
}
