/**
 * useDiscoveryProgress
 *
 * Single-responsibility hook that manages the research-phase state for a
 * Discovery session:
 *   - Status hydration from GET /status on mount, refresh, and reconnect.
 *   - Socket.IO event streaming with session join and deduplication by `seq`.
 *   - Bounded 2-second polling *only* while research is active; stops on
 *     terminal status or when live events are sufficient.
 *   - Stable reconnecting / error states exposed to the UI.
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

// ── Types ─────────────────────────────────────────────────────────────────────

export type ConnectionState = 'idle' | 'connected' | 'reconnecting' | 'failed'

export interface ProgressState {
  sessionStatus: DiscoverySessionStatus | null
  events: DiscoveryProgressEvent[]       // ordered, deduplicated by seq
  connectionState: ConnectionState
  restoredFromStatus: boolean            // true after a HTTP /status recovery
  error: string | null                   // stable error-code string
}

type Action =
  | { type: 'STATUS_LOADED'; status: DiscoverySessionStatus; events: DiscoveryProgressEvent[] }
  | { type: 'PROGRESS_EVENT'; event: DiscoveryProgressEvent }
  | { type: 'CONNECTED' }
  | { type: 'RECONNECTING' }
  | { type: 'SOCKET_FAILED'; error: string }
  | { type: 'RESTORED' }

// ── ACTIVE statuses — polling stops once we leave these ───────────────────────

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
  return status === 'ready_for_chat' || status === 'partial_ready' || status === 'research_failed'
}

// ── Error-code mapping ────────────────────────────────────────────────────────

function mapStatusToError(status: DiscoverySessionStatus | null): string | null {
  if (status === 'partial_ready') return 'errorPartialResearch'
  if (status === 'research_failed') return 'errorResearchFailed'
  return null
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
  error: null,
}

function reducer(state: ProgressState, action: Action): ProgressState {
  switch (action.type) {
    case 'STATUS_LOADED':
      return {
        ...state,
        sessionStatus: action.status,
        events: mergeEvents(state.events, action.events),
        error: mapStatusToError(action.status),
        restoredFromStatus: true,
      }
    case 'PROGRESS_EVENT':
      return {
        ...state,
        sessionStatus: action.event.payload?.session_status as DiscoverySessionStatus | undefined ?? state.sessionStatus,
        events: mergeEvents(state.events, [action.event]),
        restoredFromStatus: false,
      }
    case 'CONNECTED':
      return { ...state, connectionState: 'connected', error: state.error === 'errorReconnecting' ? null : state.error }
    case 'RECONNECTING':
      return { ...state, connectionState: 'reconnecting', error: 'errorReconnecting' }
    case 'SOCKET_FAILED':
      return { ...state, connectionState: 'failed', error: action.error }
    case 'RESTORED':
      return { ...state, restoredFromStatus: true }
    default:
      return state
  }
}

// ── Hook ──────────────────────────────────────────────────────────────────────

const WS_URL =
  (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001') + '/ws/v1/discovery'

const POLL_INTERVAL_MS = 2000

interface Options {
  sessionId: string
  authToken?: string
}

export function useDiscoveryProgress({ sessionId, authToken }: Options): ProgressState {
  const [state, dispatch] = useReducer(reducer, initialState)
  const socketRef = useRef<Socket | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const mountedRef = useRef(true)

  // ── Status hydration ───────────────────────────────────────────────────────
  const loadStatus = useCallback(async () => {
    try {
      const res = await getDiscoveryStatus(sessionId, authToken)
      if (!mountedRef.current) return
      dispatch({
        type: 'STATUS_LOADED',
        status: res.status,
        events: res.progress_events,
      })
    } catch {
      // silently ignore — the socket will surface errors
    }
  }, [sessionId, authToken])

  // ── Polling lifecycle ──────────────────────────────────────────────────────
  // Use a ref to always have the latest loadStatus without adding it to dependency array if it changes
  const loadStatusRef = useRef(loadStatus)
  useEffect(() => {
    loadStatusRef.current = loadStatus
  }, [loadStatus])

  useEffect(() => {
    // Only poll if we are actively researching AND disconnected
    const shouldPoll = isResearchActive(state.sessionStatus) && state.connectionState !== 'connected'
    
    if (!shouldPoll) return

    const intervalId = setInterval(() => {
      loadStatusRef.current()
    }, POLL_INTERVAL_MS)

    return () => clearInterval(intervalId)
  }, [state.sessionStatus, state.connectionState])

  // ── Socket.IO connection ───────────────────────────────────────────────────
  useEffect(() => {
    mountedRef.current = true

    // 1. Hydrate from HTTP on first mount (handles refresh/reconnect)
    loadStatus()

    // 2. Open Socket.IO connection
    const socket = io(WS_URL, {
      auth: authToken ? { token: authToken } : undefined,
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

    socket.on('reconnect', () => {
      if (!mountedRef.current) return
      dispatch({ type: 'CONNECTED' })
      // Re-hydrate from HTTP to recover missed events
      loadStatus()
    })

    socket.on('reconnect_failed', () => {
      if (!mountedRef.current) return
      dispatch({ type: 'SOCKET_FAILED', error: 'errorGeneric' })
    })

    return () => {
      mountedRef.current = false
      socket.disconnect()
      socketRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, authToken])

  return state
}
