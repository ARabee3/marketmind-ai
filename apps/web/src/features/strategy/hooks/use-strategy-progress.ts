'use client'

import { useCallback, useEffect, useReducer, useRef } from 'react'
import { io, type Socket } from 'socket.io-client'
import type {
  StrategyProgressEvent,
  StrategyStatus,
} from '@marketmind/contracts'
import { getStrategy, getStrategyProgress } from '@/lib/api/strategy'
import { refreshAccessToken } from '@/lib/api/client'
import { getAccessToken } from '@/lib/api/token-store'
import { WS_BASE_URL } from '@/lib/api/config'

const ACTIVE_STATUSES: Set<StrategyStatus> = new Set([
  'retrieving',
  'queued',
  'generating',
  'validating',
])

const TERMINAL_STATUSES: Set<StrategyStatus> = new Set([
  'draft',
  'approved',
  'rejected',
  'failed',
])

const POLL_INTERVAL_MS = 2000
const WS_URL = `${WS_BASE_URL}/ws/v1/strategy`

export type ConnectionState = 'idle' | 'connected' | 'reconnecting' | 'failed'

export type StrategyProgressConnectionState = ConnectionState

export interface UseStrategyProgressResult {
  status: StrategyStatus | null
  progress: readonly StrategyProgressEvent[]
  isActive: boolean
  isTerminal: boolean
}

export function isActiveStatus(status: StrategyStatus | null): boolean {
  return status !== null && ACTIVE_STATUSES.has(status)
}

export function isTerminalStatus(status: StrategyStatus | null): boolean {
  return status !== null && TERMINAL_STATUSES.has(status)
}

function statusFromProgressEvent(
  currentStatus: StrategyStatus | null,
  event: StrategyProgressEvent,
): StrategyStatus | null {
  // HTTP remains authoritative for terminal states. Live events may still
  // optimistically move a ready workspace into an active phase before the
  // next status-only poll completes.
  if (isTerminalStatus(currentStatus)) return currentStatus

  switch (event.stage) {
    case 'retrieval':
      return event.status === 'failed'
        ? 'failed'
        : event.status === 'complete'
          ? 'queued'
          : 'retrieving'
    case 'queued':
      return 'queued'
    case 'generating':
      return 'generating'
    case 'validating':
      return 'validating'
    case 'failed':
      return 'failed'
    default:
      return currentStatus
  }
}

interface ProgressState {
  status: StrategyStatus | null
  events: StrategyProgressEvent[]
  connectionState: StrategyProgressConnectionState
}

type Action =
  | { type: 'RESET' }
  | {
      type: 'STATUS_LOADED'
      status: StrategyStatus
      events: StrategyProgressEvent[]
    }
  | { type: 'STATUS_FAILED' }
  | { type: 'PROGRESS_EVENT'; event: StrategyProgressEvent }
  | { type: 'PROGRESS_EVENTS'; events: StrategyProgressEvent[] }
  | { type: 'CONNECTED' }
  | { type: 'RECONNECTING' }
  | { type: 'CONNECTION_FAILED' }

const initialState: ProgressState = {
  status: null,
  events: [],
  connectionState: 'idle',
}

function mergeEvents(
  existing: StrategyProgressEvent[],
  incoming: readonly StrategyProgressEvent[],
): StrategyProgressEvent[] {
  const seen = new Set(existing.map((event) => event.seq))
  const merged = [...existing]

  for (const event of incoming) {
    if (seen.has(event.seq)) continue
    merged.push(event)
    seen.add(event.seq)
  }

  return merged.sort((a, b) => a.seq - b.seq)
}

function reducer(state: ProgressState, action: Action): ProgressState {
  switch (action.type) {
    case 'RESET':
      return initialState
    case 'STATUS_LOADED':
      return {
        ...state,
        status: action.status,
        events: mergeEvents(state.events, action.events),
      }
    case 'STATUS_FAILED':
      return state
    case 'PROGRESS_EVENT':
      return {
        ...state,
        status: statusFromProgressEvent(state.status, action.event),
        events: mergeEvents(state.events, [action.event]),
      }
    case 'PROGRESS_EVENTS':
      return {
        ...state,
        events: mergeEvents(state.events, action.events),
      }
    case 'CONNECTED':
      return { ...state, connectionState: 'connected' }
    case 'RECONNECTING':
      return { ...state, connectionState: 'reconnecting' }
    case 'CONNECTION_FAILED':
      return { ...state, connectionState: 'failed' }
    default:
      return state
  }
}

export function useStrategyProgress(
  strategyId: string | null,
): UseStrategyProgressResult {
  const [state, dispatch] = useReducer(reducer, initialState)
  const mountedRef = useRef(true)
  const socketRef = useRef<Socket | null>(null)

  const hydrate = useCallback(async (): Promise<StrategyStatus | null> => {
    if (!strategyId || !mountedRef.current) return null

    try {
      // Status is authoritative for terminal detection; progress is a
      // separate compatibility endpoint and may fail without hiding status.
      const [result, events] = await Promise.all([
        getStrategy(strategyId),
        getStrategyProgress(strategyId).catch(() => []),
      ])
      if (!mountedRef.current) return null

      const status = result.status as StrategyStatus
      dispatch({ type: 'STATUS_LOADED', status, events })
      return status
    } catch {
      if (mountedRef.current) dispatch({ type: 'STATUS_FAILED' })
      return null
    }
  }, [strategyId])

  const refreshStatus =
    useCallback(async (): Promise<StrategyStatus | null> => {
      if (!strategyId || !mountedRef.current) return null

      try {
        const result = await getStrategy(strategyId)
        if (!mountedRef.current) return null

        const status = result.status as StrategyStatus
        // A status-only refresh deliberately keeps the existing event list. The
        // WebSocket is the event stream; history is fetched only during
        // hydration and reconnect recovery.
        dispatch({ type: 'STATUS_LOADED', status, events: [] })
        return status
      } catch {
        if (mountedRef.current) dispatch({ type: 'STATUS_FAILED' })
        return null
      }
    }, [strategyId])

  const loadStatusRef = useRef(refreshStatus)
  useEffect(() => {
    loadStatusRef.current = refreshStatus
  }, [refreshStatus])

  useEffect(() => {
    if (!isActiveStatus(state.status)) return

    const intervalId = setInterval(() => {
      void loadStatusRef.current()
    }, POLL_INTERVAL_MS)

    return () => clearInterval(intervalId)
  }, [state.status])

  useEffect(() => {
    mountedRef.current = true
    dispatch({ type: 'RESET' })

    if (!strategyId) return

    let refreshedAfterAuthError = false
    void hydrate()

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
      socket.emit('strategy.join', { strategy_id: strategyId })
    })

    socket.on(
      'connect_error',
      async (error?: Error & { data?: { status?: number } }) => {
        if (!mountedRef.current) return

        const isAuthError =
          error?.message === 'Authentication error' ||
          error?.data?.status === 401
        if (isAuthError && !refreshedAfterAuthError) {
          refreshedAfterAuthError = true
          const token = await refreshAccessToken()
          if (token && mountedRef.current) {
            socket.connect()
            return
          }
        }

        dispatch({ type: 'CONNECTION_FAILED' })
      },
    )

    socket.on('strategy.progress', (event: StrategyProgressEvent) => {
      if (!mountedRef.current) return
      dispatch({ type: 'PROGRESS_EVENT', event })
    })

    socket.on(
      'strategy.progress.snapshot',
      (events: StrategyProgressEvent[]) => {
        if (!mountedRef.current) return
        dispatch({ type: 'PROGRESS_EVENTS', events })
      },
    )

    socket.on('disconnect', () => {
      if (!mountedRef.current) return
      dispatch({ type: 'RECONNECTING' })
    })

    socket.io.on('reconnect', () => {
      if (!mountedRef.current) return
      dispatch({ type: 'CONNECTED' })
      // Recover anything emitted while the socket was offline. The HTTP
      // endpoint remains the terminal-status source of truth.
      void hydrate()
    })

    socket.io.on('reconnect_failed', () => {
      if (!mountedRef.current) return
      dispatch({ type: 'CONNECTION_FAILED' })
    })

    socket.on('strategy.error', () => {
      if (!mountedRef.current) return
      dispatch({ type: 'CONNECTION_FAILED' })
    })

    return () => {
      mountedRef.current = false
      socket.emit('strategy.leave', { strategy_id: strategyId })
      socket.disconnect()
      socketRef.current = null
    }
  }, [strategyId, hydrate])

  return {
    status: state.status,
    progress: state.events,
    isActive: state.status !== null && isActiveStatus(state.status),
    isTerminal: state.status !== null && isTerminalStatus(state.status),
  }
}
