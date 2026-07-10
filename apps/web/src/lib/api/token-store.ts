/**
 * In-memory access-token store.
 *
 * The access token is kept in a module-level variable so it is available to
 * the API client without being passed through React props, and so it is never
 * written to localStorage, sessionStorage, or any other persistent browser
 * store. It is cleared on full page reload, which is the intended behaviour for
 * a short-lived access token.
 */

export type TokenListener = (token: string | null) => void

let accessToken: string | null = null
const listeners = new Set<TokenListener>()

export function getAccessToken(): string | null {
  return accessToken
}

export function setAccessToken(token: string | null): void {
  accessToken = token
  listeners.forEach((listener) => listener(token))
}

export function subscribeToTokenChanges(listener: TokenListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
