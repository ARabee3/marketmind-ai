import { routing } from '@/i18n/routing'

const LOCALES = routing.locales as readonly string[]

const WORKSPACE_SEGMENTS = new Set([
  'billing',
  'connections',
  'content',
  'dashboard',
  'discovery',
  'publishing',
  'strategy',
])

const GUEST_ONLY_SEGMENTS = new Set([
  'auth',
  'forgot-password',
  'login',
  'register',
  'resend-verification',
])

function pathSegments(pathname: string): string[] {
  const segments = pathname.split('/').filter(Boolean)
  return LOCALES.includes(segments[0] ?? '') ? segments.slice(1) : segments
}

export function isWorkspacePath(pathname: string): boolean {
  return WORKSPACE_SEGMENTS.has(pathSegments(pathname)[0] ?? '')
}

export function isGuestOnlyPath(pathname: string): boolean {
  return GUEST_ONLY_SEGMENTS.has(pathSegments(pathname)[0] ?? '')
}

/**
 * Accept only locale-neutral workspace destinations from the login `from`
 * parameter. This keeps post-login navigation inside MarketMind and avoids
 * treating external or guest-only URLs as trusted redirect targets.
 */
export function safeWorkspaceReturnPath(value: string | null): string | null {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) {
    return null
  }

  const target = new URL(value, 'https://marketmind.local')
  if (target.origin !== 'https://marketmind.local' || !isWorkspacePath(target.pathname)) {
    return null
  }

  const segments = target.pathname.split('/').filter(Boolean)
  const pathname = LOCALES.includes(segments[0] ?? '')
    ? `/${segments.slice(1).join('/')}`
    : target.pathname

  return `${pathname}${target.search}${target.hash}`
}
