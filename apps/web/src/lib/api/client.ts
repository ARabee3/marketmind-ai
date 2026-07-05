import { getAccessToken, setAccessToken } from './token-store'
import { startRefresh } from './refresh-mutex'

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? ''

export type ApiRequestOptions = Omit<RequestInit, 'body'> & {
  body?: unknown
}

export type ApiError = Error & {
  status?: number
  response?: Response
}

function buildUrl(path: string): string {
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path
  }
  const base = API_BASE_URL.replace(/\/$/, '')
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return `${base}${normalizedPath}`
}

function buildHeaders(options: ApiRequestOptions): Headers {
  const headers = new Headers(options.headers)
  if (options.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  return headers
}

function buildBody(options: ApiRequestOptions): BodyInit | undefined {
  if (options.body === undefined) return undefined
  if (typeof options.body === 'string') return options.body
  if (options.body instanceof FormData) return options.body
  if (options.body instanceof URLSearchParams) return options.body
  if (options.body instanceof Blob) return options.body
  if (options.body instanceof ArrayBuffer) return options.body
  return JSON.stringify(options.body)
}

async function performRefresh(): Promise<string | null> {
  return startRefresh(async () => {
    try {
      const response = await fetch(buildUrl('/auth/refresh'), {
        method: 'POST',
        credentials: 'include',
      })

      if (!response.ok) {
        setAccessToken(null)
        return null
      }

      const data = (await response.json()) as { accessToken?: string }
      const token = data.accessToken ?? null
      setAccessToken(token)
      return token
    } catch {
      setAccessToken(null)
      return null
    }
  })
}

async function executeRequest(
  url: string,
  options: ApiRequestOptions,
  token: string | null,
): Promise<Response> {
  const headers = buildHeaders(options)
  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }

  return fetch(url, {
    ...options,
    headers,
    credentials: 'include',
    body: buildBody(options),
  })
}

/**
 * Explicitly refresh the access token using the HttpOnly refresh cookie.
 *
 * Safe to call from user-land (e.g. a "refresh session" button) because it
 * shares the same mutex used by `apiRequest`, so concurrent callers wait for
 * the same refresh result.
 */
export async function refreshAccessToken(): Promise<string | null> {
  return performRefresh()
}

/**
 * Makes an authenticated API request.
 *
 * - Sends the in-memory access token in the `Authorization` header.
 * - Sends cookies (including the HttpOnly refresh token) via
 *   `credentials: 'include'`.
 * - On 401, performs exactly one token refresh and retries the original
 *   request once with the new token.
 * - Uses a mutex so that concurrent 401s trigger exactly one refresh request.
 */
export async function apiRequest(
  path: string,
  options: ApiRequestOptions = {},
): Promise<Response> {
  const url = buildUrl(path)
  const token = getAccessToken()

  const response = await executeRequest(url, options, token)

  if (response.status !== 401) {
    return response
  }

  const newToken = await performRefresh()

  if (!newToken) {
    // Refresh failed; return the original 401 response. The caller (or the
    // session provider) is responsible for handling unauthenticated state.
    return response
  }

  // Retry exactly once with the new token.
  return executeRequest(url, options, newToken)
}
