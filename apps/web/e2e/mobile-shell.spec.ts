import { test, expect } from '@playwright/test'
import { mockAuthLogin, mockAuthRefresh, mockAuthMe, mockAuthLogout } from './fixtures/auth'

const locales = ['en', 'ar'] as const

test.use({ viewport: { width: 375, height: 667 } })

for (const locale of locales) {
  test.describe(`Mobile shell auth controls (${locale})`, () => {
    test('shows login and register actions in the mobile top bar when unauthenticated', async ({ page }) => {
      await mockAuthRefresh(page, null)
      await page.goto(`/${locale}/`)

      const header = page.locator('header')
      await expect(header.getByRole('link', { name: /Sign in|تسجيل الدخول/i })).toBeVisible()
      await expect(header.getByRole('link', { name: /Create account|إنشاء الحساب/i })).toBeVisible()
    })

    test('shows logout action in the mobile top bar when authenticated', async ({ page }) => {
      await mockAuthLogin(page)
      await mockAuthRefresh(page)
      await mockAuthMe(page)
      await page.goto(`/${locale}/`)

      const header = page.locator('header')
      await expect(header.getByRole('button', { name: /Sign out|تسجيل الخروج/i })).toBeVisible()
    })

    test('logs out from the mobile top bar and redirects to login', async ({ page }) => {
      await mockAuthLogin(page)
      await mockAuthRefresh(page)
      await mockAuthMe(page)
      await mockAuthLogout(page)
      await page.goto(`/${locale}/`)

      await page.getByRole('button', { name: /Sign out|تسجيل الخروج/i }).click()

      await expect(page).toHaveURL(new RegExp(`/${locale}/login`))
    })
  })
}
