import type { Page } from '@playwright/test'

export type MockUser = {
  id: string
  fullName: string
  email: string
  role: 'owner'
}

export const mockUser: MockUser = {
  id: 'user-1',
  fullName: 'Ahmed Hassan',
  email: 'ahmed@example.com',
  role: 'owner',
}

export const mockAccessToken = 'mock-access-token'
export const REFRESH_TOKEN_COOKIE = 'refreshToken'

function refreshCookieHeader(token: string): Record<string, string> {
  return {
    'Set-Cookie': `${REFRESH_TOKEN_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/`,
  }
}

export type TokenRotation = {
  calls: number
  tokens: string[]
}

export type AuthFixture = {
  rotation: TokenRotation
}

/**
 * Mocks the backend Google OAuth authorization endpoint.
 *
 * The real backend sets the OAuth state cookie and redirects the browser to
 * Google's consent screen. In tests we short-circuit that and redirect back to
 * the localized frontend callback with the requested query parameters.
 */
export async function mockAuthGoogleRedirect(
  page: Page,
  locale: 'en' | 'ar',
  query: Record<string, string>,
) {
  const params = new URLSearchParams(query)
  const location = `http://localhost:3000/${locale}/oauth/callback?${params.toString()}`

  await routeFor(page, '**/auth/google', async (route, request) => {
    if (request.method() !== 'GET') {
      await route.fallback()
      return
    }

    await route.fulfill({
      status: 302,
      headers: {
        Location: location,
      },
    })
  })
}

function routeFor(page: Page, pattern: string | RegExp, handler: Parameters<Page['route']>[1]) {
  return page.route(pattern, handler)
}

export async function mockAuthRegister(page: Page, options: { existingEmail?: string } = {}) {
  await routeFor(page, '**/auth/register', async (route, request) => {
    if (request.method() !== 'POST') {
      await route.fallback()
      return
    }
    const body = await request.postDataJSON()
    if (options.existingEmail && body.email === options.existingEmail) {
      await route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'EMAIL_EXISTS' }),
      })
      return
    }
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ user: mockUser }),
    })
  })
}

export async function mockAuthLogin(page: Page, options: { validPassword?: string } = {}) {
  await routeFor(page, '**/auth/login', async (route, request) => {
    if (request.method() !== 'POST') {
      await route.fallback()
      return
    }
    const body = await request.postDataJSON()
    if (body.email !== mockUser.email || body.password !== (options.validPassword ?? 'Password123!')) {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'INVALID_CREDENTIALS' }),
      })
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: refreshCookieHeader('mock-refresh-token'),
      body: JSON.stringify({ accessToken: mockAccessToken, user: mockUser }),
    })
  })
}

export async function mockAuthLogout(page: Page) {
  await routeFor(page, '**/auth/logout', async (route, request) => {
    if (request.method() !== 'POST') {
      await route.fallback()
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: {
        'Set-Cookie': `${REFRESH_TOKEN_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`,
      },
      body: JSON.stringify({ ok: true }),
    })
  })
}

export async function mockAuthMe(page: Page, user: MockUser | null = mockUser) {
  await routeFor(page, '**/auth/me', async (route) => {
    if (!user) {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'UNAUTHORIZED' }),
      })
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ user }),
    })
  })
}

/**
 * Mocks the token refresh endpoint.
 *
 * - `token: string | null` returns the same token every call (or 401 if null).
 * - `token: string[]` returns the next token in the sequence on each call.
 *   Use `null` inside the array to simulate a failed refresh for that call.
 * - The returned `rotation` object records every refresh call and token issued.
 */
export async function mockAuthRefresh(
  page: Page,
  token: string | null | (string | null)[] = mockAccessToken,
): Promise<AuthFixture> {
  const tokens = Array.isArray(token) ? token : token === null ? [] : [token]
  const rotation: TokenRotation = { calls: 0, tokens: [] }

  await routeFor(page, '**/auth/refresh', async (route, request) => {
    if (request.method() !== 'POST') {
      await route.fallback()
      return
    }

    rotation.calls += 1

    const index = rotation.calls - 1
    const nextToken = index < tokens.length ? tokens[index] : tokens[tokens.length - 1]

    if (nextToken === null) {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'UNAUTHORIZED' }),
      })
      return
    }

    rotation.tokens.push(nextToken)

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: refreshCookieHeader(`refresh-${nextToken}`),
      body: JSON.stringify({ accessToken: nextToken }),
    })
  })

  return { rotation }
}

/**
 * Simulates a protected endpoint that returns 401 the first time and 200 after
 * the client refreshes its access token. The returned `authorizationHeaders`
 * array captures the `Authorization` header sent on each request so tests can
 * verify token rotation.
 */
export async function mockProtectedResource(
  page: Page,
  options: { rotatedToken: string; user?: MockUser } = { rotatedToken: 'rotated-token' },
): Promise<{ authorizationHeaders: string[] }> {
  const authorizationHeaders: string[] = []
  let firstCall = true

  await routeFor(page, '**/auth/me', async (route, request) => {
    const header = await request.headerValue('Authorization')
    if (header) authorizationHeaders.push(header)

    if (firstCall) {
      firstCall = false
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'UNAUTHORIZED' }),
      })
      return
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ user: options.user ?? mockUser }),
    })
  })

  return { authorizationHeaders }
}
