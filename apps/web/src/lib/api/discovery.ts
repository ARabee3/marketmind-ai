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
