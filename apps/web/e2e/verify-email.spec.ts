import { test, expect } from '@playwright/test'
import { mockAuthResendVerification, REFRESH_TOKEN_COOKIE } from './fixtures/auth'

const locales = ['en', 'ar'] as const

for (const locale of locales) {
  test.describe(`Verify-email (${locale})`, () => {
    test('auto-verifies on mount and offers a sign-in link', async ({ page }) => {
      await page.route('**/auth/verify-email', async (route, request) => {
        if (request.method() !== 'POST') {
          await route.fallback()
          return
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'Email verified successfully' }),
        })
      })

      // Unprefixed mail link — proxy should honour NEXT_LOCALE then accept-language.
      await page.context().addCookies([
        { name: 'NEXT_LOCALE', value: locale, url: 'http://localhost:3000' },
      ])
      await page.goto(`/verify-email?token=valid-token`)
      await expect(page).toHaveURL(new RegExp(`/${locale}/verify-email`))

      await expect(
        page.getByText(locale === 'ar' ? /تم تأكيد البريد الإلكتروني/ : /Email verified/i),
      ).toBeVisible()
      await expect(
        page.getByRole('link', { name: /Go to sign in|اذهب إلى تسجيل الدخول/ }),
      ).toBeVisible()

      // No tokens should be persisted by the public verify flow.
      const cookies = await page.context().cookies()
      expect(cookies.find((c) => c.name === REFRESH_TOKEN_COOKIE)).toBeUndefined()
      expect(await page.evaluate(() => window.localStorage.length)).toBe(0)
    })

    test('offers an inline resend form when the link has expired', async ({ page }) => {
      await page.route('**/auth/verify-email', async (route, request) => {
        if (request.method() !== 'POST') {
          await route.fallback()
          return
        }
        await route.fulfill({
          status: 422,
          contentType: 'application/json',
          body: JSON.stringify({ code: 'ACTION_TOKEN_EXPIRED' }),
        })
      })
      await mockAuthResendVerification(page)

      await page.goto(`/${locale}/verify-email?token=expiring`)

      await expect(
        page.getByText(
          locale === 'ar'
            ? /انتهت صلاحية رابط التأكيد/
            : /This verification link has expired/i,
        ),
      ).toBeVisible()

      await page
        .getByRole('button', { name: /Resend verification email|إعادة إرسال رسالة التأكيد/ })
        .click()

      await page
        .getByLabel(/Email address|البريد الإلكتروني/)
        .first()
        .fill('ahmed@example.com')
      await page
        .getByRole('button', { name: /Resend link|إعادة إرسال الرابط/ })
        .click()

      await expect(
        page.getByText(
          locale === 'ar' ? /تحقق من بريدك الإلكتروني/ : /Check your email/i,
        ),
      ).toBeVisible()
    })

    test('honours the resend route in standalone form and respects the rate-limit error', async ({ page }) => {
      await mockAuthResendVerification(page, 'rateLimited')

      await page.goto(`/${locale}/resend-verification`)
      await expect(page).toHaveURL(new RegExp(`/${locale}/resend-verification`))

      await page
        .getByLabel(/Email address|البريد الإلكتروني/)
        .first()
        .fill('ahmed@example.com')
      await page
        .getByRole('button', { name: /Resend link|إعادة إرسال الرابط/ })
        .click()

      await expect(page.locator('form [role="alert"]')).toContainText(
        locale === 'ar' ? /محاولات كثيرة/ : /Too many attempts/i,
      )
    })

    test('preserves the locale when navigating from the mail-link redirect', async ({ page }) => {
      await page.route('**/auth/verify-email', async (route, request) => {
        if (request.method() !== 'POST') {
          await route.fallback()
          return
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'Email verified successfully' }),
        })
      })

      await page.context().addCookies([
        { name: 'NEXT_LOCALE', value: locale, url: 'http://localhost:3000' },
      ])
      await page.goto(`/verify-email?token=locale-token`)
      await expect(page).toHaveURL(new RegExp(`/${locale}/verify-email`))
      expect(await page.evaluate(() => document.documentElement.lang)).toBe(locale)
    })
  })
}