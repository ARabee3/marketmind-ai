/**
 * useDiscoverySession
 *
 * Client-side Discovery session controller whose authoritative state is the
 * latest `DiscoveryStatusResponse` from GET /status.
 *
 * - Hydrates on mount, after mutations, and on recovery.
 * - All mutations (respond, summarize, confirm) refresh /status on success.
 * - Ambiguous failures recover via /status before allowing further actions.
 * - Synchronous ref/lock prevents duplicate submissions while pending.
 * - Locale switching and browser refresh issue only GET /status.
 */

'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  DiscoveryStatusResponse,
  DiscoverySummarizeRequest,
  ConfirmProfileRequest,
} from '@marketmind/contracts'
import {
  getDiscoveryStatus,
  respondToDiscovery,
  summarizeDiscovery,
  confirmDiscoveryProfile,
  type ApiError,
} from '@/lib/api/discovery'
import { getApiErrorTranslationKey } from '@/features/discovery/lib/api-error-localization'
import type { TranslationKey } from '@/i18n/types'

export type SessionPhase =
  | 'loading'
  | 'researching'
  | 'interview'
  | 'review'
  | 'confirmed'
  | 'failed'
  | 'load_error'

export interface DiscoverySessionState {
  status: DiscoveryStatusResponse | null
  phase: SessionPhase
  pending: boolean
  error: string | null
  errorTranslationKey: TranslationKey | null
}

interface Options {
  sessionId: string
  authToken?: string
}

function getPhaseFromStatus(status: DiscoveryStatusResponse['status']): SessionPhase {
  if (status === 'researching') return 'researching'
  if (
    status === 'partial_ready' ||
    status === 'ready_for_chat' ||
    status === 'research_failed' ||
    status === 'in_progress'
  )
    return 'interview'
  if (status === 'summary_ready') return 'review'
  if (status === 'confirmed') return 'confirmed'
  if (status === 'failed' || status === 'cancelled') return 'failed'
  return 'loading'
}

export function useDiscoverySession({ sessionId, authToken }: Options) {
  const [state, setState] = useState<DiscoverySessionState>({
    status: null,
    phase: 'loading',
    pending: false,
    error: null,
    errorTranslationKey: null,
  })

  const pendingRef = useRef(false)
  const mountedRef = useRef(true)

  const setPending = useCallback((value: boolean) => {
    pendingRef.current = value
    setState((prev) => ({ ...prev, pending: value }))
  }, [])

  const loadStatus = useCallback(async (): Promise<DiscoveryStatusResponse | null> => {
    setState((prev) => ({ ...prev, error: null, errorTranslationKey: null }))
    try {
      const res = await getDiscoveryStatus(sessionId, authToken)
      if (!mountedRef.current) return null
      setState({
        status: res,
        phase: getPhaseFromStatus(res.status),
        pending: pendingRef.current,
        error: null,
        errorTranslationKey: null,
      })
      return res
    } catch (err) {
      if (!mountedRef.current) return null
      const apiErr = err as ApiError
      const key = getApiErrorTranslationKey(apiErr)
      setState((prev) => ({
        ...prev,
        phase: prev.status ? prev.phase : 'load_error',
        pending: false,
        error: apiErr.message || 'network error',
        errorTranslationKey: key,
      }))
      return null
    }
  }, [sessionId, authToken])

  // Initial hydration
  useEffect(() => {
    mountedRef.current = true
    const init = async () => {
      await loadStatus()
    }
    init()
    return () => {
      mountedRef.current = false
    }
  }, [loadStatus])

  const respond = useCallback(
    async (message: string): Promise<{ accepted: boolean }> => {
      if (pendingRef.current) return { accepted: false }
      if (message.trim().length === 0) return { accepted: false }

      setPending(true)
      setState((prev) => ({ ...prev, error: null, errorTranslationKey: null }))

      // Capture pre-submit owner message fingerprint for recovery comparison
      const preOwnerIds = new Set(state.status?.messages?.filter((m) => m.role === 'owner').map((m) => m.id) ?? [])
      const preOwnerCount = preOwnerIds.size

      try {
        await respondToDiscovery(
          sessionId,
          { message },
          authToken,
        )
      } catch (err) {
        // Ambiguous: refresh status to determine actual state
        const recovered = await loadStatus()
        if (!mountedRef.current) return { accepted: false }

        const postOwnerMessages = recovered?.messages?.filter((m) => m.role === 'owner') ?? []
        const postOwnerCount = postOwnerMessages.length
        const newOwnerPersisted = postOwnerCount > preOwnerCount || postOwnerMessages.some((m) => !preOwnerIds.has(m.id))

        if (!newOwnerPersisted) {
          const apiErr = err as ApiError
          setState((prev) => ({
            ...prev,
            pending: false,
            error: apiErr.message || 'respond failed',
            errorTranslationKey: getApiErrorTranslationKey(apiErr),
          }))
          pendingRef.current = false
          return { accepted: false }
        }

        // Owner message was persisted despite the POST error response; treat as accepted
        setPending(false)
        return { accepted: true }
      }

      // Success: refresh to get authoritative persisted state
      await loadStatus()
      if (!mountedRef.current) return { accepted: false }

      setPending(false)
      return { accepted: true }
    },
    [sessionId, authToken, loadStatus, setPending, state.status],
  )

  const summarize = useCallback(
    async (payload: DiscoverySummarizeRequest) => {
      if (pendingRef.current) return

      setPending(true)
      setState((prev) => ({ ...prev, error: null, errorTranslationKey: null }))

      try {
        await summarizeDiscovery(sessionId, payload, authToken)
      } catch (err) {
        await loadStatus()
        if (!mountedRef.current) return
        const apiErr = err as ApiError
        setState((prev) => ({
          ...prev,
          pending: false,
          error: apiErr.message || 'summarize failed',
          errorTranslationKey: getApiErrorTranslationKey(apiErr),
        }))
        pendingRef.current = false
        return
      }

      await loadStatus()
      if (!mountedRef.current) return
      setPending(false)
    },
    [sessionId, authToken, loadStatus, setPending],
  )

  const confirm = useCallback(
    async (payload: ConfirmProfileRequest) => {
      if (pendingRef.current) return

      setPending(true)
      setState((prev) => ({ ...prev, error: null, errorTranslationKey: null }))

      try {
        await confirmDiscoveryProfile(sessionId, payload, authToken)
      } catch (err) {
        await loadStatus()
        if (!mountedRef.current) return
        const apiErr = err as ApiError
        setState((prev) => ({
          ...prev,
          pending: false,
          error: apiErr.message || 'confirm failed',
          errorTranslationKey: getApiErrorTranslationKey(apiErr),
        }))
        pendingRef.current = false
        return
      }

      await loadStatus()
      if (!mountedRef.current) return
      setPending(false)
    },
    [sessionId, authToken, loadStatus, setPending],
  )

  const retryLoad = useCallback(() => {
    setState((prev) => ({ ...prev, phase: 'loading', error: null, errorTranslationKey: null }))
    loadStatus()
  }, [loadStatus])

  return {
    ...state,
    respond,
    summarize,
    confirm,
    retryLoad,
    refresh: loadStatus,
  }
}
