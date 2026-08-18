import {
  assertValidPerformanceOverview,
  assertValidPerformanceSyncWindow,
  type PerformanceOverviewV1,
  type PerformanceSyncWindowV1,
} from '@marketmind/contracts'
import { apiRequest, type ApiRequestOptions } from './client'

export type PerformanceApiError = Error & {
  readonly status: number
  readonly code: string
}

export type PerformanceRefreshResponse = {
  readonly status: 'queued' | 'not_due' | 'rate_limited'
  readonly windows: readonly PerformanceSyncWindowV1[]
}

type RawRecord = Record<string, unknown>

async function request<T>(path: string, init?: ApiRequestOptions): Promise<T> {
  const response = await apiRequest(path, init)
  if (!response.ok) throw await toApiError(response)
  return (await response.json()) as T
}

export async function getPerformanceOverview(): Promise<PerformanceOverviewV1> {
  const value = await request<unknown>('/performance/facebook/overview')
  assertValidPerformanceOverview(value)
  return value
}

export async function refreshPerformancePost(
  publishingResultId: string,
): Promise<PerformanceRefreshResponse> {
  const value = await request<unknown>(
    `/performance/facebook/posts/${encodeURIComponent(publishingResultId)}/refresh`,
    { method: 'POST' },
  )
  const record = asRecord(value)
  const status = record.status
  if (status !== 'queued' && status !== 'not_due' && status !== 'rate_limited') {
    throw new Error('Performance refresh response contained an unsupported status.')
  }
  const windows = Array.isArray(record.windows) ? record.windows : []
  for (const window of windows) assertValidPerformanceSyncWindow(window)
  return { status, windows }
}

async function toApiError(response: Response): Promise<PerformanceApiError> {
  let code = 'performance_api_error'
  let message = response.statusText || 'Performance request failed.'

  try {
    const body = (await response.json()) as RawRecord
    const nested = isRecord(body.error) ? body.error : null
    code = stringValue(body.code) ?? stringValue(nested?.code) ?? code
    message =
      stringValue(body.message) ?? stringValue(nested?.message) ?? message
  } catch {
    // Keep the status-backed fallback when the API does not return JSON.
  }

  const error = new Error(message) as PerformanceApiError
  Object.defineProperties(error, {
    status: { value: response.status, enumerable: true },
    code: { value: code, enumerable: true },
  })
  return error
}

function isRecord(value: unknown): value is RawRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function asRecord(value: unknown): RawRecord {
  return isRecord(value) ? value : {}
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}
