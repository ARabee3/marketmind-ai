/**
 * Refresh mutex.
 *
 * Guarantees that only one token refresh request runs at a time. Concurrent
 * callers receive the same promise and therefore share the single refresh
 * result. The promise is cleared as soon as refresh settles so a subsequent
 * failure can attempt a new refresh.
 */

let refreshPromise: Promise<string | null> | null = null

export function getRefreshPromise(): Promise<string | null> | null {
  return refreshPromise
}

export function startRefresh(
  refresher: () => Promise<string | null>,
): Promise<string | null> {
  if (!refreshPromise) {
    refreshPromise = refresher().finally(() => {
      refreshPromise = null
    })
  }
  return refreshPromise
}
