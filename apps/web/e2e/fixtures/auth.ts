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
    'Set-Cookie': `${REFRESH_TOKEN_COOKIE}=e2e-${token}; HttpOnly; SameSite=Lax; Path=/`,
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
  const location = `http://localhost:3000/oauth/callback?${params.toString()}`

  await page.context().addCookies([
    { name: 'NEXT_LOCALE', value: locale, url: 'http://localhost:3000' },
  ])

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

  const initialToken = Array.isArray(token) ? token[0] : token
  if (initialToken) {
    await page.context().addCookies([
      {
        name: REFRESH_TOKEN_COOKIE,
        value: `e2e-${initialToken}`,
        url: 'http://localhost:3000',
        httpOnly: true,
        sameSite: 'Lax',
      },
    ])
  } else {
    await page.context().clearCookies({ name: REFRESH_TOKEN_COOKIE })
  }

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

/**
 * Controls the response to POST /auth/forgot-password. Pass an empty string to
 * hit a generic success; pass 'RATE_LIMIT_EXCEEDED' to surface a 429. Subsequent
 * changes to `mode` after the mock is installed are not honored — re-mock per test.
 */
export async function mockAuthForgotPassword(
  page: Page,
  mode: 'success' | 'rateLimited' = 'success',
) {
  await routeFor(page, '**/auth/forgot-password', async (route, request) => {
    if (request.method() !== 'POST') {
      await route.fallback()
      return
    }
    if (mode === 'rateLimited') {
      await route.fulfill({
        status: 429,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'RATE_LIMIT_EXCEEDED' }),
      })
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        message:
          'If an account with that email exists, a password reset link has been sent',
      }),
    })
  })
}

/**
 * Controls the response to POST /auth/reset-password based on the token in the
 * request body. `token` -> 200; `expired` -> ACTION_TOKEN_EXPIRED; `consumed` ->
 * ACTION_TOKEN_CONSUMED; `invalid` -> ACTION_TOKEN_INVALID. Unknown tokens fall
 * back to invalid so tests fail loudly on typos.
 */
export async function mockAuthResetPassword(page: Page) {
  await routeFor(page, '**/auth/reset-password', async (route, request) => {
    if (request.method() !== 'POST') {
      await route.fallback()
      return
    }
    const body = await request.postDataJSON()
    const codeByToken: Record<string, string> = {
      expired: 'ACTION_TOKEN_EXPIRED',
      consumed: 'ACTION_TOKEN_CONSUMED',
      invalid: 'ACTION_TOKEN_INVALID',
    }
    const code = codeByToken[body.token]
    if (code) {
      await route.fulfill({
        status: 422,
        contentType: 'application/json',
        body: JSON.stringify({ code }),
      })
      return
    }
    if (!body.token) {
      await route.fulfill({
        status: 422,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'ACTION_TOKEN_INVALID' }),
      })
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Password has been reset successfully' }),
    })
  })
}

/**
 * Controls the response to POST /auth/verify-email based on the token in the
 * request body, mirroring mockAuthResetPassword.
 */
export async function mockAuthVerifyEmail(page: Page) {
  await routeFor(page, '**/auth/verify-email', async (route, request) => {
    if (request.method() !== 'POST') {
      await route.fallback()
      return
    }
    const body = await request.postDataJSON()
    const codeByToken: Record<string, string> = {
      expired: 'ACTION_TOKEN_EXPIRED',
      consumed: 'ACTION_TOKEN_CONSUMED',
      invalid: 'ACTION_TOKEN_INVALID',
      rateLimited: 'RATE_LIMIT_EXCEEDED',
    }
    const code = codeByToken[body.token]
    if (code) {
      await route.fulfill({
        status: code === 'RATE_LIMIT_EXCEEDED' ? 429 : 422,
        contentType: 'application/json',
        body: JSON.stringify({ code }),
      })
      return
    }
    if (!body.token) {
      await route.fulfill({
        status: 422,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'ACTION_TOKEN_INVALID' }),
      })
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Email verified successfully' }),
    })
  })
}

/**
 * Controls the response to POST /auth/resend-verification. Mirrors
 * mockAuthForgotPassword's mode contract.
 */
export async function mockAuthResendVerification(
  page: Page,
  mode: 'success' | 'rateLimited' = 'success',
) {
  await routeFor(page, '**/auth/resend-verification', async (route, request) => {
    if (request.method() !== 'POST') {
      await route.fallback()
      return
    }
    if (mode === 'rateLimited') {
      await route.fulfill({
        status: 429,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'RATE_LIMIT_EXCEEDED' }),
      })
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        message:
          'If an unverified account with that email exists, a new verification link has been sent',
      }),
    })
  })
}
