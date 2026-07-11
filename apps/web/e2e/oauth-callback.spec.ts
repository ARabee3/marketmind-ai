import { test, expect, type Page } from '@playwright/test'
import {
  mockAuthGoogleRedirect,
  mockAuthRefresh,
  mockAuthMe,
  mockAuthLogout,
} from './fixtures/auth'

const locales = ['en', 'ar'] as const

type StorageEntry = {
  key: string
  value: string
}

function assertNoAuthTokensInStorage(
  entries: StorageEntry[],
  issuedTokens: string[],
) {
  const forbiddenTerms = ['accessToken', 'refreshToken', 'oauth', ...issuedTokens]
  const leaks = entries.filter((entry) =>
    forbiddenTerms.some((term) => {
      const lowerTerm = term.toLowerCase()
      return (
        entry.key.toLowerCase().includes(lowerTerm) ||
        entry.value.toLowerCase().includes(lowerTerm)
      )
    }),
  )
  expect(leaks).toEqual([])
}

async function readBrowserStorage(page: Page): Promise<StorageEntry[]> {
  return page.evaluate(() => {
    const entries: StorageEntry[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key !== null) {
        entries.push({ key, value: localStorage.getItem(key) ?? '' })
      }
    }
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i)
      if (key !== null) {
        entries.push({ key, value: sessionStorage.getItem(key) ?? '' })
      }
    }
    return entries
  })
}

for (const locale of locales) {
  test.describe(`OAuth callback (${locale})`, () => {
    test('completes Google sign in, restores the session, and redirects to dashboard', async ({ page }) => {
      const { rotation } = await mockAuthRefresh(page, [null, 'callback-token'])
      await mockAuthMe(page)
      await mockAuthGoogleRedirect(page, locale, { status: 'success' })

      await page.goto(`/${locale}/login`)
      await page.getByRole('button', { name: /Continue with Google|المتابعة باستخدام Google/i }).click()

      await expect(page).toHaveURL(`/${locale}/dashboard`, { timeout: 10000 })
      await expect(page.getByRole('heading')).toContainText(
        locale === 'ar' ? 'ماركت مايند' : 'MarketMind',
      )
      expect(rotation.calls).toBe(2)
    })

    test('shows a retry screen when session bootstrap finishes unauthenticated', async ({ page }) => {
      const { rotation } = await mockAuthRefresh(page, [null, null])
      await mockAuthGoogleRedirect(page, locale, { status: 'success' })

      await page.goto(`/${locale}/login`)
      await page.getByRole('button', { name: /Continue with Google|المتابعة باستخدام Google/i }).click()

      await expect(page).toHaveURL(new RegExp(`/${locale}/oauth/callback`))
      await expect(page.getByText(
        locale === 'ar' ? /تعذّر إكمال تسجيل الدخول/i : /could not complete sign in/i,
      )).toBeVisible()
      await expect(page.getByRole('button', { name: /Retry|إعادة المحاولة/i })).toBeVisible()
      expect(rotation.calls).toBe(2)
    })

    test('retry restores the session and redirects to dashboard', async ({ page }) => {
      const { rotation } = await mockAuthRefresh(page, [null, null, 'retry-token'])
      await mockAuthMe(page)
      await mockAuthGoogleRedirect(page, locale, { status: 'success' })

      await page.goto(`/${locale}/login`)
      await page.getByRole('button', { name: /Continue with Google|المتابعة باستخدام Google/i }).click()

      await expect(page.getByRole('button', { name: /Retry|إعادة المحاولة/i })).toBeVisible()
      await page.getByRole('button', { name: /Retry|إعادة المحاولة/i }).click()

      await expect(page).toHaveURL(`/${locale}/dashboard`, { timeout: 10000 })
      expect(rotation.calls).toBe(3)
    })

    test('handles provider denial or cancellation with a safe combined state', async ({ page }) => {
      await mockAuthRefresh(page, null)
      await mockAuthGoogleRedirect(page, locale, {
        error: 'OAUTH_PROVIDER_ERROR',
        message: 'user denied permission',
      })

      await page.goto(`/${locale}/login`)
      await page.getByRole('button', { name: /Continue with Google|المتابعة باستخدام Google/i }).click()

      await expect(page).toHaveURL(new RegExp(`/${locale}/oauth/callback`))
      await expect(page.getByText(
        locale === 'ar' ? /تعذّر إنهاء تسجيل الدخول/i : /sign in could not finish/i,
      )).toBeVisible()
      await expect(page.getByText('user denied permission')).toHaveCount(0)
    })

    test('handles password-account conflict with an actionable state', async ({ page }) => {
      await mockAuthRefresh(page, null)
      await mockAuthGoogleRedirect(page, locale, {
        error: 'OAUTH_EMAIL_ALREADY_USED_PASSWORD',
        message: 'email already registered',
      })

      await page.goto(`/${locale}/login`)
      await page.getByRole('button', { name: /Continue with Google|المتابعة باستخدام Google/i }).click()

      await expect(page.getByText(
        locale === 'ar'
          ? /الحساب يستخدم تسجيل الدخول بكلمة المرور/i
          : /account already uses password sign in/i,
      )).toBeVisible()
      await expect(page.getByText('email already registered')).toHaveCount(0)
    })

    test('handles an invalid or malformed callback safely', async ({ page }) => {
      await mockAuthRefresh(page, null)
      await page.goto(`/${locale}/oauth/callback?foo=bar&message=unexpected`)

      await expect(page.getByText(
        locale === 'ar' ? /فشل تسجيل الدخول/i : /sign in failed/i,
      )).toBeVisible()
      await expect(page.getByText('unexpected')).toHaveCount(0)
    })

    test('back-to-sign-in action returns to the localized login page', async ({ page }) => {
      await mockAuthRefresh(page, null)
      await mockAuthGoogleRedirect(page, locale, {
        error: 'OAUTH_STATE_MISMATCH',
        message: 'state mismatch',
      })

      await page.goto(`/${locale}/login`)
      await page.getByRole('button', { name: /Continue with Google|المتابعة باستخدام Google/i }).click()

      await page.getByRole('link', { name: /Back to sign in|العودة إلى تسجيل الدخول/i }).click()
      await expect(page).toHaveURL(new RegExp(`/${locale}/login`))
    })

    test('preserves locale through the OAuth redirect', async ({ page }) => {
      await mockAuthRefresh(page, [null, 'callback-token'])
      await mockAuthMe(page)
      await mockAuthGoogleRedirect(page, locale, { status: 'success' })

      await page.goto(`/${locale}/login`)
      await page.getByRole('button', { name: /Continue with Google|المتابعة باستخدام Google/i }).click()

      await expect(page).toHaveURL(`/${locale}/dashboard`, { timeout: 10000 })
      expect(new URL(page.url()).pathname.startsWith(`/${locale}/`)).toBe(true)
    })

    test('does not leak tokens into localStorage or sessionStorage after OAuth success', async ({ page }) => {
      await mockAuthRefresh(page, [null, 'callback-token'])
      await mockAuthMe(page)
      await mockAuthGoogleRedirect(page, locale, { status: 'success' })

      await page.goto(`/${locale}/login`)
      await page.getByRole('button', { name: /Continue with Google|المتابعة باستخدام Google/i }).click()

      await expect(page).toHaveURL(`/${locale}/dashboard`, { timeout: 10000 })

      const storage = await readBrowserStorage(page)
      assertNoAuthTokensInStorage(storage, ['callback-token'])
    })

    test('logout and protected-route regression after Google sign in', async ({ page }) => {
      await mockAuthRefresh(page, [null, 'callback-token'])
      await mockAuthMe(page)
      await mockAuthLogout(page)
      await mockAuthGoogleRedirect(page, locale, { status: 'success' })

      await page.goto(`/${locale}/login`)
      await page.getByRole('button', { name: /Continue with Google|المتابعة باستخدام Google/i }).click()

      await expect(page).toHaveURL(`/${locale}/dashboard`, { timeout: 10000 })

      await page.getByRole('button', { name: /Sign out|تسجيل الخروج/i }).click()
      await expect(page).toHaveURL(new RegExp(`/${locale}/login`))

      // After logout, the next protected request should require authentication.
      await mockAuthRefresh(page, null)
      await page.goto(`/${locale}/dashboard`)
      await expect(page).toHaveURL(new RegExp(`/${locale}/login`))
    })
  })
}
