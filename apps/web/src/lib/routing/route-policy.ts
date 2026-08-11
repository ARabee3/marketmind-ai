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

const ADMIN_SEGMENTS = new Set(['admin'])

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

export function isAdminPath(pathname: string): boolean {
  return ADMIN_SEGMENTS.has(pathSegments(pathname)[0] ?? '')
}

function safeReturnPath(
  value: string | null,
  isAllowedPath: (pathname: string) => boolean,
): string | null {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) {
    return null
  }

  const target = new URL(value, 'https://marketmind.local')
  if (target.origin !== 'https://marketmind.local' || !isAllowedPath(target.pathname)) {
    return null
  }

  const segments = target.pathname.split('/').filter(Boolean)
  const pathname = LOCALES.includes(segments[0] ?? '')
    ? `/${segments.slice(1).join('/')}`
    : target.pathname

  return `${pathname}${target.search}${target.hash}`
}

/**
 * Accept only locale-neutral workspace destinations from the login `from`
 * parameter. This keeps post-login navigation inside MarketMind and avoids
 * treating external or guest-only URLs as trusted redirect targets.
 */
export function safeWorkspaceReturnPath(value: string | null): string | null {
  return safeReturnPath(value, isWorkspacePath)
}

/**
 * Accept only locale-neutral admin destinations from the login `from`
 * parameter. Admin users can return to the protected page that sent them to
 * sign in without allowing an external redirect.
 */
export function safeAdminReturnPath(value: string | null): string | null {
  return safeReturnPath(value, isAdminPath)
}
