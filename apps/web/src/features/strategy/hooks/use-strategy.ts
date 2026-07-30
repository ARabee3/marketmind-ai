'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { getStrategy, type StrategyApiResponse } from '@/lib/api/strategy'

export interface UseStrategyResult {
  strategy: StrategyApiResponse | null
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
}

export function useStrategy(strategyId: string | null): UseStrategyResult {
  const [strategy, setStrategy] = useState<StrategyApiResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const mountedRef = useRef(true)

  const load = useCallback(async (showLoading = true) => {
    if (!strategyId) {
      setStrategy(null)
      setLoading(false)
      return
    }
    if (showLoading) setLoading(true)
    setError(null)
    try {
      const result = await getStrategy(strategyId)
      if (mountedRef.current) {
        setStrategy(result)
      }
    } catch (err) {
      if (mountedRef.current) {
        const message = err && typeof err === 'object' && 'message' in err
          ? (err as { message: string }).message
          : 'Failed to load strategy'
        setError(message)
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false)
      }
    }
  }, [strategyId])

  useEffect(() => {
    mountedRef.current = true
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
    return () => { mountedRef.current = false }
  }, [load])

  return {
    strategy,
    loading,
    error,
    refresh: () => load(false),
  }
}
