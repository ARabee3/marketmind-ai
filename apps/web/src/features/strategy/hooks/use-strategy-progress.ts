'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { StrategyProgressEvent, StrategyStatus } from '@marketmind/contracts'
import { getStrategy, getStrategyProgress } from '@/lib/api/strategy'

const ACTIVE_STATUSES: Set<StrategyStatus> = new Set([
  'retrieving', 'queued', 'generating', 'validating',
])

const TERMINAL_STATUSES: Set<StrategyStatus> = new Set([
  'draft', 'approved', 'rejected', 'failed',
])

const POLL_INTERVAL_MS = 2000

export interface UseStrategyProgressResult {
  status: StrategyStatus | null
  progress: readonly StrategyProgressEvent[]
  isActive: boolean
  isTerminal: boolean
}

export function isActiveStatus(status: StrategyStatus): boolean {
  return ACTIVE_STATUSES.has(status)
}

export function isTerminalStatus(status: StrategyStatus): boolean {
  return TERMINAL_STATUSES.has(status)
}

export function useStrategyProgress(strategyId: string | null): UseStrategyProgressResult {
  const [status, setStatus] = useState<StrategyStatus | null>(null)
  const [progress, setProgress] = useState<readonly StrategyProgressEvent[]>([])
  const mountedRef = useRef(true)

  const poll = useCallback(async () => {
    if (!mountedRef.current || !strategyId) return
    try {
      const result = await getStrategy(strategyId)
      const events = await getStrategyProgress(strategyId)
      if (!mountedRef.current) return
      const s = result.status as StrategyStatus
      setStatus(s)
      setProgress(events)
      return s
    } catch {
      return null
    }
  }, [strategyId])

  useEffect(() => {
    mountedRef.current = true
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStatus(null)
    setProgress([])

    if (!strategyId) return

    let cancelled = false
    let intervalId: ReturnType<typeof setInterval> | undefined

    const start = async () => {
      const s = await poll()
      if (cancelled || !mountedRef.current) return
      if (s && !isActiveStatus(s)) return
      intervalId = setInterval(() => {
        if (mountedRef.current) poll()
      }, POLL_INTERVAL_MS)
    }

    start()

    return () => {
      cancelled = true
      mountedRef.current = false
      clearInterval(intervalId)
    }
  }, [strategyId, poll])

  return {
    status,
    progress,
    isActive: status !== null && isActiveStatus(status),
    isTerminal: status !== null && isTerminalStatus(status),
  }
}
