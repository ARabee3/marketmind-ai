/**
 * Temporary mock auth hook until Issue #19 is merged.
 * TODO: Replace with real auth context from #19
 */
export function useAuth() {
  return {
    token: 'temp-dev-token',
    isAuthenticated: true,
  }
}
