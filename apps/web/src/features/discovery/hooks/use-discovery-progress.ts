/**
 * useDiscoveryProgress
 *
 * Single-responsibility hook that manages the research-phase state for a
 * Discovery session:
 *   - Status hydration from GET /status on mount, refresh, and reconnect.
 *   - Socket.IO event streaming with session join and deduplication by `seq`.
 *   - Bounded 2-second polling *only* while status is `researching`; stops on
 *     any non-research state.
 *   - Stable, separated connection state/error and persistent research warning.
 *
 * The hook is side-effect free of UI rendering — all presentation decisions
 * live in the progress timeline component.
 */

'use client'

import { useCallback, useEffect, useReducer, useRef } from 'react'
import { io, type Socket } from 'socket.io-client'
import type {
  DiscoveryProgressEvent,
  DiscoverySessionStatus,
} from '@marketmind/contracts'
import { getDiscoveryStatus } from '@/lib/api/discovery'
import { refreshAccessToken } from '@/lib/api/client'
import { getAccessToken } from '@/lib/api/token-store'
import { WS_BASE_URL } from '@/lib/api/config'
import type { TranslationKey } from '@/i18n/types'
import { getResearchWarningKey } from '@/features/discovery/lib/progress-localization'

// ── Types ─────────────────────────────────────────────────────────────────────

export type ConnectionState = 'idle' | 'connected' | 'reconnecting' | 'failed'

export interface ProgressState {
  sessionStatus: DiscoverySessionStatus | null
  events: DiscoveryProgressEvent[]       // ordered, deduplicated by seq
  connectionState: ConnectionState
  restoredFromStatus: boolean            // true after a HTTP /status recovery
  connectionError: TranslationKey | null // transient connection problems
  researchWarning: TranslationKey | null // persisted status-based warnings
}

type Action =
  | { type: 'STATUS_LOADED'; status: DiscoverySessionStatus; events: DiscoveryProgressEvent[] }
  | { type: 'STATUS_FAILED' }
  | { type: 'PROGRESS_EVENT'; event: DiscoveryProgressEvent }
  | { type: 'CONNECTED' }
  | { type: 'RECONNECTING' }
  | { type: 'CONNECTION_FAILED'; error: TranslationKey }
  | { type: 'RESTORED' }

// ── Status helpers ────────────────────────────────────────────────────────────

const ACTIVE_STATUSES = new Set<DiscoverySessionStatus>([
  'researching',
])

const TERMINAL_STATUSES = new Set<DiscoverySessionStatus>([
  'confirmed', 'failed', 'cancelled',
])

export function isResearchActive(status: DiscoverySessionStatus | null): boolean {
  return status !== null && ACTIVE_STATUSES.has(status)
}

export function isTerminal(status: DiscoverySessionStatus | null): boolean {
  return status !== null && TERMINAL_STATUSES.has(status)
}

export function canOpenInterview(status: DiscoverySessionStatus | null): boolean {
  return status === 'ready_for_chat' || status === 'partial_ready' || status === 'research_failed' || status === 'in_progress'
}

// ── Reducer ───────────────────────────────────────────────────────────────────

function mergeEvents(
  existing: DiscoveryProgressEvent[],
  incoming: DiscoveryProgressEvent[],
): DiscoveryProgressEvent[] {
  const seen = new Set(existing.map((e) => e.seq))
  const merged = [...existing]
  for (const evt of incoming) {
    if (!seen.has(evt.seq)) {
      merged.push(evt)
      seen.add(evt.seq)
    }
  }
  return merged.sort((a, b) => a.seq - b.seq)
}

const initialState: ProgressState = {
  sessionStatus: null,
  events: [],
  connectionState: 'idle',
  restoredFromStatus: false,
  connectionError: null,
  researchWarning: null,
}

function reducer(state: ProgressState, action: Action): ProgressState {
  switch (action.type) {
    case 'STATUS_LOADED':
      return {
        ...state,
        sessionStatus: action.status,
        events: mergeEvents(state.events, action.events),
        researchWarning: getResearchWarningKey(action.status),
        restoredFromStatus: true,
        // A successful status load clears transient connection errors.
        connectionError: null,
      }
    case 'STATUS_FAILED':
      return {
        ...state,
        connectionError: 'Errors.networkError',
        restoredFromStatus: false,
      }
    case 'PROGRESS_EVENT': {
      const nextStatus = action.event.payload?.session_status as DiscoverySessionStatus | undefined
      return {
        ...state,
        sessionStatus: nextStatus ?? state.sessionStatus,
        events: mergeEvents(state.events, [action.event]),
        researchWarning: nextStatus ? getResearchWarningKey(nextStatus) : state.researchWarning,
        restoredFromStatus: false,
      }
    }
    case 'CONNECTED':
      return { ...state, connectionState: 'connected', connectionError: null }
    case 'RECONNECTING':
      return {
        ...state,
        connectionState: 'reconnecting',
        // Reconnecting is a transient state label, not a persistent error.
        connectionError: null,
      }
    case 'CONNECTION_FAILED':
      return {
        ...state,
        connectionState: 'failed',
        connectionError: action.error,
      }
    case 'RESTORED':
      return { ...state, restoredFromStatus: true }
    default:
      return state
  }
}

// ── Hook ──────────────────────────────────────────────────────────────────────

const WS_URL = `${WS_BASE_URL}/ws/v1/discovery`

const POLL_INTERVAL_MS = 2000

interface Options {
  sessionId: string
}

export function useDiscoveryProgress({ sessionId }: Options): ProgressState {
  const [state, dispatch] = useReducer(reducer, initialState)
  const socketRef = useRef<Socket | null>(null)

  const mountedRef = useRef(true)

  // ── Status hydration ───────────────────────────────────────────────────────
  const loadStatus = useCallback(async () => {
    try {
      const res = await getDiscoveryStatus(sessionId)
      if (!mountedRef.current) return
      dispatch({
        type: 'STATUS_LOADED',
        status: res.status,
        events: res.progress_events,
      })
    } catch {
      if (!mountedRef.current) return
      dispatch({ type: 'STATUS_FAILED' })
    }
  }, [sessionId])

  // ── Polling lifecycle ──────────────────────────────────────────────────────
  // Use a ref to always have the latest loadStatus without adding it to
  // the effect dependency array on every render.
  const loadStatusRef = useRef(loadStatus)
  useEffect(() => {
    loadStatusRef.current = loadStatus
  }, [loadStatus])

  useEffect(() => {
    // Only poll while the authoritative /status reports researching.
    // Live events don't always carry session_status, so HTTP polling is the
    // source of truth for when research has finished.
    const shouldPoll = isResearchActive(state.sessionStatus)

    if (!shouldPoll) return

    const intervalId = setInterval(() => {
      loadStatusRef.current()
    }, POLL_INTERVAL_MS)

    return () => clearInterval(intervalId)
  }, [state.sessionStatus])

  // ── Socket.IO connection ───────────────────────────────────────────────────
  useEffect(() => {
    mountedRef.current = true
    let refreshedAfterAuthError = false

    // 1. Hydrate from HTTP on first mount (handles refresh/reconnect)
    loadStatus()

    // 2. Open Socket.IO connection
    const socket = io(WS_URL, {
      withCredentials: true,
      auth: (callback) => callback({ token: getAccessToken() }),
      transports: ['websocket'],
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    })
    socketRef.current = socket

    socket.on('connect', () => {
      if (!mountedRef.current) return
      dispatch({ type: 'CONNECTED' })
      socket.emit('discovery.join', { session_id: sessionId })
    })

    socket.on('connect_error', async (error?: Error & { data?: { status?: number } }) => {
      if (!mountedRef.current) return

      const isAuthError =
        error?.message === 'Authentication error' || error?.data?.status === 401
      if (isAuthError && !refreshedAfterAuthError) {
        refreshedAfterAuthError = true
        const token = await refreshAccessToken()
        if (token && mountedRef.current) {
          socket.connect()
          return
        }
      }

      dispatch({ type: 'CONNECTION_FAILED', error: 'DiscoveryProgress.connectionFailed' })
    })

    socket.on('discovery.progress', (event: DiscoveryProgressEvent) => {
      if (!mountedRef.current) return
      dispatch({ type: 'PROGRESS_EVENT', event })
    })

    // snapshot on join — deduplicated by reducer
    socket.on('discovery.progress.snapshot', (events: DiscoveryProgressEvent[]) => {
      if (!mountedRef.current) return
      events.forEach((event) => dispatch({ type: 'PROGRESS_EVENT', event }))
    })

    socket.on('disconnect', () => {
      if (!mountedRef.current) return
      dispatch({ type: 'RECONNECTING' })
    })

    socket.io.on('reconnect', () => {
      if (!mountedRef.current) return
      dispatch({ type: 'CONNECTED' })
      // Re-hydrate from HTTP to recover missed events
      loadStatus()
    })

    socket.io.on('reconnect_failed', () => {
      if (!mountedRef.current) return
      dispatch({ type: 'CONNECTION_FAILED', error: 'DiscoveryProgress.connectionFailed' })
    })

    socket.on('discovery.error', () => {
      if (!mountedRef.current) return
      dispatch({ type: 'CONNECTION_FAILED', error: 'DiscoveryProgress.errorGeneric' })
    })

    return () => {
      mountedRef.current = false
      socket.disconnect()
      socketRef.current = null
    }
  }, [sessionId, loadStatus])

  return state
}
