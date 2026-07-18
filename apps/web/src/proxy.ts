import createMiddleware from 'next-intl/middleware'
import { NextResponse, type NextRequest } from 'next/server'
import { routing } from './i18n/routing'

const intlMiddleware = createMiddleware(routing)

const API_BASE_URL = (
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1'
).replace(/\/$/, '')

const SESSION_PATH = '/auth/session'
const LOCALES = routing.locales as readonly string[]
const WORKSPACE_SEGMENTS = new Set(['dashboard', 'discovery'])
const REFRESH_COOKIE = 'refreshToken'
const LOCALE_COOKIE = 'NEXT_LOCALE'

/**
 * Workspace routes are the `(workspace)` route group: `/dashboard` and
 * `/discovery*` under any locale prefix. Route groups are not part of the URL,
 * so we match the resolved path segments.
 */
function isWorkspacePath(pathname: string): boolean {
  const segments = pathname.split('/').filter(Boolean)
  const first = segments[0]
  if (LOCALES.includes(first)) {
    return WORKSPACE_SEGMENTS.has(segments[1] ?? '')
  }
  return WORKSPACE_SEGMENTS.has(first ?? '')
}

function localeFor(request: NextRequest, pathname: string): string {
  const segments = pathname.split('/').filter(Boolean)
  const first = segments[0]
  if (LOCALES.includes(first)) return first
  const cookieLocale = request.cookies.get(LOCALE_COOKIE)?.value
  if (cookieLocale && LOCALES.includes(cookieLocale)) return cookieLocale
  return routing.defaultLocale
}

/**
 * Real server-side session check. Forwards the HttpOnly refresh cookie to the
 * non-rotating `/auth/session` endpoint, which validates it against the stored
 * hash via `JwtRefreshGuard` without issuing or rotating any token. This is the
 * authorization boundary for workspace routes; Nest JWT/RBAC guards remain the
 * data-access boundary.
 */
async function isWorkspaceAuthorized(request: NextRequest): Promise<boolean> {
  const refreshToken = request.cookies.get(REFRESH_COOKIE)?.value
  if (!refreshToken) return false
  try {
    const response = await fetch(`${API_BASE_URL}${SESSION_PATH}`, {
      method: 'GET',
      headers: { cookie: `${REFRESH_COOKIE}=${refreshToken}` },
      cache: 'no-store',
    })
    return response.ok
  } catch {
    return false
  }
}

export default async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl

  if (isWorkspacePath(pathname)) {
    const authorized = await isWorkspaceAuthorized(request)
    if (!authorized) {
      const locale = localeFor(request, pathname)
      const from = encodeURIComponent(pathname + (search || ''))
      const loginUrl = request.nextUrl.clone()
      loginUrl.pathname = `/${locale}/login`
      loginUrl.search = `?from=${from}`
      return NextResponse.redirect(loginUrl, 302)
    }
    return intlMiddleware(request)
  }

  return intlMiddleware(request)
}

export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|_vercel|favicon.ico|sitemap.xml|robots.txt|.*\\..*).*)',
  ],
}