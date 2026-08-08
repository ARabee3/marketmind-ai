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
import { getAccessToken } from '@/lib/api/token-store'
import { API_BASE_URL } from '@/lib/api/config'

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
  if (typeof window === 'undefined' || typeof EventSource === 'undefined') {
    return () => {}
  }
  const token = getAccessToken()
  const url = `${API_BASE_URL}/discovery/${sessionId}/stream${token ? `?token=${encodeURIComponent(token)}` : ''}`
  const es = new EventSource(url, { withCredentials: true })

  es.onmessage = (ev) => {
    try {
      const parsed = JSON.parse(ev.data) as DiscoveryStreamEvent
      onEvent(parsed)
    } catch {
      // ignore parse errors
    }
  }

  return () => {
    es.close()
  }
}
