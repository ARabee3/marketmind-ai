/**
 * Discovery API client.
 *
 * Consumes shared @marketmind/contracts types — do not duplicate those types here.
 * All requests use the centralized API_BASE_URL from @/lib/api/config.
 */

import type {
  StartPreparedDiscoveryRequest,
  StartPreparedDiscoveryResponse,
  DiscoveryStatusResponse,
  DiscoveryRespondRequest,
  DiscoveryRespondResponse,
  DiscoverySummarizeRequest,
  DiscoverySummarizeResponse,
  ConfirmProfileRequest,
  ConfirmProfileResponse,
  DiscoveryTranscriptionResponse,
  DiscoveryStreamEvent,
  ErrorCode,
} from '@marketmind/contracts'
import { apiRequest, type ApiRequestOptions } from '@/lib/api/client'

export interface ApiError {
  status: number
  code: ErrorCode | string
  message: string
}

async function request<T>(
  path: string,
  init?: ApiRequestOptions,
): Promise<T> {
  const res = await apiRequest(path, init)

  if (!res.ok) {
    let code: ErrorCode | string = 'api_error'
    let message = res.statusText
    try {
      const body = await res.json()
      code = body?.code ?? body?.error?.code ?? code
      message = body?.message ?? body?.error?.message ?? message
    } catch {
      // ignore parse errors
    }
    const err: ApiError = { status: res.status, code, message }
    throw err
  }

  return res.json() as Promise<T>
}

/** POST /api/v1/discovery/start — returns 202 Accepted */
export function startDiscovery(
  payload: StartPreparedDiscoveryRequest,
): Promise<StartPreparedDiscoveryResponse> {
  return request<StartPreparedDiscoveryResponse>('/discovery/start', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

/** GET /api/v1/discovery/:sessionId/status */
export function getDiscoveryStatus(
  sessionId: string,
): Promise<DiscoveryStatusResponse> {
  return request<DiscoveryStatusResponse>(`/discovery/${sessionId}/status`)
}

/** POST /api/v1/discovery/:sessionId/retry-interview */
export function retryDiscoveryInterview(
  sessionId: string,
): Promise<DiscoveryStatusResponse> {
  return request<DiscoveryStatusResponse>(
    `/discovery/${sessionId}/retry-interview`,
    {
      method: 'POST',
    },
  )
}

/** POST /api/v1/discovery/:sessionId/respond */
export function respondToDiscovery(
  sessionId: string,
  payload: DiscoveryRespondRequest,
): Promise<DiscoveryRespondResponse> {
  return request<DiscoveryRespondResponse>(`/discovery/${sessionId}/respond`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

/** POST /api/v1/discovery/:sessionId/summarize */
export function summarizeDiscovery(
  sessionId: string,
  payload: DiscoverySummarizeRequest,
): Promise<DiscoverySummarizeResponse> {
  return request<DiscoverySummarizeResponse>(`/discovery/${sessionId}/summarize`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

/** POST /api/v1/discovery/:sessionId/confirm-profile */
export function confirmDiscoveryProfile(
  sessionId: string,
  payload: ConfirmProfileRequest,
): Promise<ConfirmProfileResponse> {
  return request<ConfirmProfileResponse>(`/discovery/${sessionId}/confirm-profile`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

/** POST /api/v1/discovery/:sessionId/transcribe */
export function transcribeDiscoveryVoiceNote(
  sessionId: string,
  audioBlob: Blob,
  languageHint = 'ar-EG',
): Promise<DiscoveryTranscriptionResponse> {
  const formData = new FormData()
  formData.append('audio', audioBlob, 'voice-note.wav')
  formData.append('language_hint', languageHint)

  return request<DiscoveryTranscriptionResponse>(
    `/discovery/${sessionId}/transcribe`,
    {
      method: 'POST',
      body: formData,
    },
  )
}

/** Connect SSE stream for progressive question presentation */
export function connectDiscoveryStream(
  sessionId: string,
  onEvent: (event: DiscoveryStreamEvent) => void,
): () => void {
  if (typeof window === 'undefined') {
    return () => {}
  }

  const controller = new AbortController()
  void consumeDiscoveryStream(sessionId, onEvent, controller.signal).catch(
    () => {
      // The existing EventSource client exposed no stream error callback. Keep
      // transport failures contained while status refresh remains authoritative.
    },
  )

  return () => controller.abort()
}

async function consumeDiscoveryStream(
  sessionId: string,
  onEvent: (event: DiscoveryStreamEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const response = await apiRequest(`/discovery/${sessionId}/stream`, {
    headers: { Accept: 'text/event-stream' },
    signal,
  })

  if (!response.ok || !response.body) return

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (!signal.aborted) {
      const { value, done } = await reader.read()
      if (value) buffer += decoder.decode(value, { stream: !done })

      if (done) {
        buffer += decoder.decode()
        buffer = dispatchCompleteSseEvents(buffer, onEvent)
        dispatchSseEvent(buffer, onEvent)
        return
      }

      buffer = dispatchCompleteSseEvents(buffer, onEvent)
    }
  } finally {
    reader.releaseLock()
  }
}

function dispatchCompleteSseEvents(
  buffer: string,
  onEvent: (event: DiscoveryStreamEvent) => void,
): string {
  let remaining = buffer

  while (true) {
    const separator = /\r?\n\r?\n/.exec(remaining)
    if (!separator || separator.index === undefined) return remaining

    const rawEvent = remaining.slice(0, separator.index)
    remaining = remaining.slice(separator.index + separator[0].length)
    dispatchSseEvent(rawEvent, onEvent)
  }
}

function dispatchSseEvent(
  rawEvent: string,
  onEvent: (event: DiscoveryStreamEvent) => void,
): void {
  const data = rawEvent
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice('data:'.length).trimStart())
    .join('\n')

  if (!data) return

  try {
    onEvent(JSON.parse(data) as DiscoveryStreamEvent)
  } catch {
    // Ignore malformed or non-JSON SSE payloads.
  }
}
