import { API_BASE_URL } from '@/lib/api/config'

/**
 * Starts the Google OAuth flow by performing a full-page browser navigation
 * to the backend's Google authorization endpoint.
 *
 * This must not use fetch/XHR because the backend needs to set the OAuth
 * state cookie and redirect the browser to Google's consent screen.
 */
export function signInWithGoogle(): void {
  window.location.href = `${API_BASE_URL}/auth/google`
}
