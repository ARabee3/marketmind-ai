import { apiRequest } from './client'
import { API_BASE_URL } from './config'

export type FacebookConnectionView = {
  provider: string
  pageName: string
  isValid: boolean
  connectedAt: string
  lastTestedAt: string | null
}

export type FacebookTestResult =
  | { success: true; postId: string }
  | { success: false; reason: 'expired' | 'error'; message?: string }

/** Origin of the API server — used to verify postMessage events from the popup. */
export const API_ORIGIN = new URL(API_BASE_URL).origin

/**
 * Fetches the current user's Facebook connection (or null when none exists).
 */
export async function getFacebookConnection(): Promise<FacebookConnectionView | null> {
  const response = await apiRequest('/connections')
  if (response.status === 404 || response.status === 204) return null
  if (!response.ok) throw new Error('Could not load the connection status.')
  return (await response.json()) as FacebookConnectionView
}

/**
 * Publishes a small test post to the connected Page.
 */
export async function testFacebookConnection(): Promise<FacebookTestResult> {
  const response = await apiRequest('/connections/facebook/test', {
    method: 'POST',
  })
  if (!response.ok) {
    throw new Error('Could not test the connection.')
  }
  return (await response.json()) as FacebookTestResult
}

/**
 * Removes the user's Facebook connection.
 */
export async function disconnectFacebookConnection(): Promise<void> {
  const response = await apiRequest('/connections/facebook', {
    method: 'DELETE',
  })
  if (!response.ok) {
    throw new Error('Could not disconnect the Facebook Page.')
  }
}

/**
 * Opens the Meta/Facebook OAuth flow in a centered popup and resolves once
 * the popup posts a result back via `window.opener.postMessage`.
 *
 * The popup is a plain browser navigation, so it cannot carry the Bearer
 * access token. The flow therefore starts with an authenticated (Bearer)
 * `POST /auth/facebook/start` that issues a short-lived HttpOnly start
 * session cookie; the popup then opens `GET /auth/facebook/start`, which the
 * backend uses that cookie for to identify the user and redirect to
 * Facebook.
 */
const POPUP_TIMEOUT_MS = 2 * 60 * 1000 // 2 minutes

export async function connectMeta(): Promise<{ pageName: string }> {
  const session = await apiRequest('/auth/facebook/start', {
    method: 'POST',
  })
  if (!session.ok) {
    throw new Error('We could not start the Facebook connection. Try again.')
  }

  const width = 600
  const height = 700
  const left = window.screenX + (window.outerWidth - width) / 2
  const top = window.screenY + (window.outerHeight - height) / 2

  const popup = window.open(
    `${API_BASE_URL}/auth/facebook/start`,
    'fb-connect',
    `width=${width},height=${height},left=${left},top=${top}`,
  )

  if (!popup) {
    throw new Error('The Facebook connection window could not be opened.')
  }

  return new Promise((resolve, reject) => {
    let settled = false

    function done(result: "resolved" | "rejected", value?: unknown) {
      if (settled) return
      settled = true
      clearTimeout(timeoutId)
      clearInterval(closeCheckId)
      window.removeEventListener("message", handler)
      try {
        popup.close()
      } catch {
        // Popup may already be closed
      }
      if (result === "resolved") resolve(value)
      else reject(new Error(value as string))
    }

    const timeoutId = setTimeout(() => {
      done("rejected", "The Facebook connection timed out. Please try again.")
    }, POPUP_TIMEOUT_MS)

    // Poll for popup close: the start-session cookie lasts 10 minutes, but
    // the popup may be closed by the user before completing OAuth.
    const closeCheckId = setInterval(() => {
      if (!popup || popup.closed) {
        done("rejected", "The Facebook connection was cancelled.")
      }
    }, 500)

    const handler = (event: MessageEvent) => {
      if (event.origin !== API_ORIGIN) return
      if (event.data?.type === 'fb-connected') {
        done("resolved", event.data.payload)
      }
      if (event.data?.type === 'fb-connect-error') {
        done("rejected", event.data.error)
      }
    }
    window.addEventListener('message', handler)
  })
}
