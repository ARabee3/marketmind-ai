import { test, expect } from '@playwright/test'

const locales = ['en', 'ar'] as const

for (const locale of locales) {
  test.describe(`Reset-password (${locale})`, () => {
    test('submits a new password and routes the user to /login?reset=true', async ({ page }) => {
      await page.route('**/auth/reset-password', async (route, request) => {
        if (request.method() !== 'POST') {
          await route.fallback()
          return
        }
        const body = await request.postDataJSON()
        expect(body.token).toBe('valid-token')
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'Password has been reset successfully' }),
        })
      })

      // Mail links are unprefixed; the next-intl proxy honours the NEXT_LOCALE
      // cookie and redirects to /<locale>/reset-password?token=...
      await page.context().addCookies([
        { name: 'NEXT_LOCALE', value: locale, url: 'http://localhost:3000' },
      ])
      await page.goto(`/reset-password?token=valid-token`)
      await expect(page).toHaveURL(new RegExp(`/${locale}/reset-password`))

      await page
        .getByLabel(/^New password$|^كلمة المرور الجديدة$/)
        .fill('Password456!')
      await page
        .getByLabel(/Confirm new password|تأكيد كلمة المرور الجديدة/)
        .fill('Password456!')
      await page
        .getByRole('button', { name: /Reset password|إعادة تعيين كلمة المرور/ })
        .click()

      await expect(
        page.getByText(
          locale === 'ar'
            ? /تمت إعادة تعيين كلمة المرور/
            : /Your password has been reset/i,
        ),
      ).toBeVisible()

      await page
        .getByRole('button', { name: /Go to sign in|اذهب إلى تسجيل الدخول/ })
        .click()

      await expect(page).toHaveURL(new RegExp(`/${locale}/login\\?reset=true`), {
        timeout: 10000,
      })
    })

    test('shows the expired recovery state for an expired token', async ({ page }) => {
      await page.route('**/auth/reset-password', async (route, request) => {
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

      await page.goto(`/${locale}/reset-password?token=expired`)

      await page
        .getByLabel(/^New password$|^كلمة المرور الجديدة$/)
        .fill('Password456!')
      await page
        .getByLabel(/Confirm new password|تأكيد كلمة المرور الجديدة/)
        .fill('Password456!')
      await page
        .getByRole('button', { name: /Reset password|إعادة تعيين كلمة المرور/ })
        .click()

      await expect(
        page.getByText(
          locale === 'ar'
            ? /انتهت صلاحية رابط الإعادة/
            : /This reset link has expired/i,
        ),
      ).toBeVisible()
      await expect(
        page.getByRole('link', { name: /Request a new link|طلب رابط جديد/ }),
      ).toBeVisible()
    })

    test('shows the invalid-link recovery path when no token is in the URL', async ({ page }) => {
      await page.goto(`/${locale}/reset-password`)
      await expect(
        page.getByText(
          locale === 'ar'
            ? /رابط إعادة تعيين غير صالح/
            : /This reset link is incomplete/i,
        ),
      ).toBeVisible()
      await expect(
        page.getByRole('link', { name: /Request a new link|طلب رابط جديد/ }),
      ).toBeVisible()
    })
  })
}