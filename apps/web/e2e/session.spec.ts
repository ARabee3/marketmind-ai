import { test, expect } from '@playwright/test'
import {
  mockAuthLogin,
  mockAuthRefresh,
  mockAuthMe,
  mockAuthLogout,
  mockProtectedResource,
  mockUser,
} from './fixtures/auth'

const locales = ['en', 'ar'] as const

for (const locale of locales) {
  test.describe(`Session lifecycle (${locale})`, () => {
    test('recovers an active session via refresh on dashboard load', async ({ page }) => {
      const { rotation } = await mockAuthRefresh(page)
      await mockAuthMe(page)
      await page.goto(`/${locale}/dashboard`)

      await expect(page).toHaveURL(`/${locale}/dashboard`)
      await expect(page.getByRole('heading')).toContainText(
        locale === 'ar' ? 'ماركت مايند' : 'MarketMind',
      )
      expect(rotation.calls).toBe(1)
    })

    test('rotates the access token when a protected request returns 401', async ({ page }) => {
      const rotatedToken = 'rotated-access-token'
      // First refresh fails so the session starts unauthenticated; the second
      // refresh is triggered by the 401 on /auth/me after login.
      const { rotation } = await mockAuthRefresh(page, [null, rotatedToken])
      const { authorizationHeaders } = await mockProtectedResource(page, {
        rotatedToken,
        user: mockUser,
      })

      await mockAuthLogin(page)
      await page.goto(`/${locale}/login`)

      await page.getByLabel(/Email address|البريد الإلكتروني/i).fill(mockUser.email)
      await page.getByLabel(/^Password$|^كلمة المرور$/i).fill('Password123!')
      await page.getByRole('button', { name: /Sign in|تسجيل الدخول/i }).click()

      await expect(page).toHaveURL(`/${locale}/dashboard`)

      // The dashboard loads via /auth/me. The first call uses the login token
      // and is rejected, triggering refresh. The retry uses the rotated token.
      await expect.poll(() => authorizationHeaders.length).toBeGreaterThanOrEqual(2)
      console.log('headers:', authorizationHeaders, 'rotation:', rotation)
      expect(rotation.calls).toBe(2)
      expect(authorizationHeaders[0]).toBe(`Bearer mock-access-token`)
      expect(authorizationHeaders.at(-1)).toBe(`Bearer ${rotatedToken}`)
    })

    test('redirects unauthenticated users from dashboard to login preserving locale', async ({ page }) => {
      await mockAuthRefresh(page, null)
      await page.goto(`/${locale}/dashboard`)

      await expect(page).toHaveURL(new RegExp(`/${locale}/login`))
    })

    test('preserves return path when redirecting to login', async ({ page }) => {
      await mockAuthRefresh(page, null)
      await page.goto(`/${locale}/dashboard`)

      await expect(page).toHaveURL(new RegExp(`/${locale}/login`))
      const search = new URL(page.url()).search
      expect(search).toContain('from=')
      // usePathname from next-intl returns the path without the locale prefix.
      expect(search).toContain(encodeURIComponent('/dashboard'))
    })

    test('logs out, clears session, and redirects to login', async ({ page }) => {
      await mockAuthLogin(page)
      await mockAuthRefresh(page)
      await mockAuthMe(page)
      await mockAuthLogout(page)
      await page.goto(`/${locale}/login`)

      await page.getByLabel(/Email address|البريد الإلكتروني/i).fill(mockUser.email)
      await page.getByLabel(/^Password$|^كلمة المرور$/i).fill('Password123!')
      await page.getByRole('button', { name: /Sign in|تسجيل الدخول/i }).click()

      await expect(page).toHaveURL(`/${locale}/dashboard`)

      await page.getByRole('button', { name: /Sign out|تسجيل الخروج/i }).click()

      await expect(page).toHaveURL(new RegExp(`/${locale}/login`))

      // After logout, the next protected request should be unauthenticated.
      await mockAuthRefresh(page, null)
      await page.goto(`/${locale}/dashboard`)
      await expect(page).toHaveURL(new RegExp(`/${locale}/login`))
    })

    test('expired session redirects back to login on refresh failure', async ({ page }) => {
      await mockAuthRefresh(page, null)
      await page.goto(`/${locale}/dashboard`)

      await expect(page).toHaveURL(new RegExp(`/${locale}/login`))
    })
  })
}
