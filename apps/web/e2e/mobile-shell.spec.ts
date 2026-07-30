import { test, expect } from '@playwright/test'
import {
  mockAuthRefresh,
  mockAuthMe,
  mockAuthLogout,
  mockUser,
} from './fixtures/auth'

const locales = ['en', 'ar'] as const

test.use({ viewport: { width: 375, height: 667 } })

for (const locale of locales) {
  test.describe(`Mobile shell auth controls (${locale})`, () => {
    test('shows login and register actions in the mobile navigation drawer when unauthenticated', async ({ page }) => {
      await mockAuthRefresh(page, null)
      await page.goto(`/${locale}/`)

      const header = page.locator('header')
      await header.getByRole('button', { name: /Open menu|فتح القائمة/i }).click()
      const menu = page.getByRole('dialog')
      await expect(menu.getByRole('link', { name: /Log in|تسجيل الدخول/i })).toBeVisible()
      await expect(menu.getByRole('link', { name: /Create account|إنشاء حساب/i })).toBeVisible()
    })

    test('shows logout action in the mobile navigation drawer when authenticated', async ({ page }) => {
      await mockAuthRefresh(page)
      await mockAuthMe(page)
      await page.addInitScript((userId) => {
        localStorage.setItem(
          `marketmind.dashboardOnboarding.v1.${userId}`,
          'dismissed',
        )
      }, mockUser.id)
      await page.goto(`/${locale}/dashboard`)

      await page
        .getByRole('button', { name: /Open navigation|فتح التنقل/i })
        .click()
      await expect(
        page.getByRole('dialog').getByRole('button', {
          name: /Sign out|تسجيل الخروج/i,
        }),
      ).toBeVisible()
    })

    test('logs out from the mobile navigation drawer and redirects to login', async ({ page }) => {
      await mockAuthRefresh(page)
      await mockAuthMe(page)
      await mockAuthLogout(page)
      await page.addInitScript((userId) => {
        localStorage.setItem(
          `marketmind.dashboardOnboarding.v1.${userId}`,
          'dismissed',
        )
      }, mockUser.id)
      await page.goto(`/${locale}/dashboard`)

      await page
        .getByRole('button', { name: /Open navigation|فتح التنقل/i })
        .click()
      await page
        .getByRole('dialog')
        .getByRole('button', { name: /Sign out|تسجيل الخروج/i })
        .click()

      await expect(page).toHaveURL(new RegExp(`/${locale}/login`))
    })
  })
}
