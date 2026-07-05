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
} from '@marketmind/contracts'

const API_BASE =
  (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001') + '/api/v1'

export interface ApiError {
  status: number
  code: string
  message: string
}

async function request<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  })

  if (!res.ok) {
    let code = 'api_error'
    let message = res.statusText
    try {
      const body = await res.json()
      code = body?.error?.code ?? code
      message = body?.error?.message ?? message
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
