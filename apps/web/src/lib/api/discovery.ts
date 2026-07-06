/**
 * Discovery API client.
 *
 * Consumes shared @marketmind/contracts types — do not duplicate those types here.
 * All requests are relative to process.env.NEXT_PUBLIC_API_URL.
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
  ErrorCode,
} from '@marketmind/contracts'

const API_BASE =
  (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001') + '/api/v1'

export interface ApiError {
  status: number
  code: ErrorCode | string
  message: string
}

async function request<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  })

  if (!res.ok) {
    let code: ErrorCode | string = 'api_error'
    let message = res.statusText
    try {
      const body = await res.json()
      code = body?.error?.code ?? body?.code ?? code
      message = body?.error?.message ?? body?.message ?? message
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
  authToken?: string,
): Promise<StartPreparedDiscoveryResponse> {
  return request<StartPreparedDiscoveryResponse>('/discovery/start', {
    method: 'POST',
    body: JSON.stringify(payload),
    headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
  })
}

/** GET /api/v1/discovery/:sessionId/status */
export function getDiscoveryStatus(
  sessionId: string,
  authToken?: string,
): Promise<DiscoveryStatusResponse> {
  return request<DiscoveryStatusResponse>(`/discovery/${sessionId}/status`, {
    headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
  })
}

/** POST /api/v1/discovery/:sessionId/respond */
export function respondToDiscovery(
  sessionId: string,
  payload: DiscoveryRespondRequest,
  authToken?: string,
): Promise<DiscoveryRespondResponse> {
  return request<DiscoveryRespondResponse>(`/discovery/${sessionId}/respond`, {
    method: 'POST',
    body: JSON.stringify(payload),
    headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
  })
}

/** POST /api/v1/discovery/:sessionId/summarize */
export function summarizeDiscovery(
  sessionId: string,
  payload: DiscoverySummarizeRequest,
  authToken?: string,
): Promise<DiscoverySummarizeResponse> {
  return request<DiscoverySummarizeResponse>(`/discovery/${sessionId}/summarize`, {
    method: 'POST',
    body: JSON.stringify(payload),
    headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
  })
}

/** POST /api/v1/discovery/:sessionId/confirm-profile */
export function confirmDiscoveryProfile(
  sessionId: string,
  payload: ConfirmProfileRequest,
  authToken?: string,
): Promise<ConfirmProfileResponse> {
  return request<ConfirmProfileResponse>(`/discovery/${sessionId}/confirm-profile`, {
    method: 'POST',
    body: JSON.stringify(payload),
    headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
  })
}
