import { test, expect } from '@playwright/test'
import { mockAuthForgotPassword, REFRESH_TOKEN_COOKIE } from './fixtures/auth'

const locales = ['en', 'ar'] as const

for (const locale of locales) {
  test.describe(`Forgot-password (${locale})`, () => {
    test('submits the email and shows the generic success state', async ({ page }) => {
      await mockAuthForgotPassword(page)
      await page.goto(`/${locale}/login`)

      await page.getByRole('link', { name: /Forgot password|هل نسيت كلمة المرور/ }).click()
      await expect(page).toHaveURL(new RegExp(`/${locale}/forgot-password`))

      await page
        .getByLabel(/Email address|البريد الإلكتروني/)
        .first()
        .fill('ahmed@example.com')
      await page
        .getByRole('button', { name: /Send reset link|إرسال رابط الإعادة/ })
        .click()

      await expect(
        page.getByText(
          locale === 'ar'
            ? /تحقق من بريدك الإلكتروني/
            : /Check your email/i,
        ),
      ).toBeVisible()
      await expect(
        page.getByRole('link', { name: /Back to sign in|العودة إلى تسجيل الدخول/ }),
      ).toBeVisible()
    })

    test('maps a RATE_LIMIT_EXCEEDED response to a visible error', async ({ page }) => {
      await mockAuthForgotPassword(page, 'rateLimited')
      await page.goto(`/${locale}/forgot-password`)

      await page
        .getByLabel(/Email address|البريد الإلكتروني/)
        .first()
        .fill('ahmed@example.com')
      await page
        .getByRole('button', { name: /Send reset link|إرسال رابط الإعادة/ })
        .click()

      await expect(page.locator('form [role="alert"]')).toContainText(
        locale === 'ar' ? /محاولات كثيرة/ : /Too many attempts/i,
      )
    })

    test('never persists a refresh token for the unauthenticated recovery flow', async ({ page }) => {
      await mockAuthForgotPassword(page)
      await page.goto(`/${locale}/forgot-password`)

      await page
        .getByLabel(/Email address|البريد الإلكتروني/)
        .first()
        .fill('ahmed@example.com')
      await page
        .getByRole('button', { name: /Send reset link|إرسال رابط الإعادة/ })
        .click()
      await expect(
        page.getByText(
          locale === 'ar' ? /تحقق من بريدك الإلكتروني/ : /Check your email/i,
        ),
      ).toBeVisible()

      const cookies = await page.context().cookies()
      expect(cookies.find((c) => c.name === REFRESH_TOKEN_COOKIE)).toBeUndefined()
      expect(
        await page.evaluate(() => window.localStorage.length),
      ).toBe(0)
    })
  })
}