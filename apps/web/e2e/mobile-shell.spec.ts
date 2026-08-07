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

    test('shows logout action in the mobile header when authenticated', async ({ page }) => {
      await mockAuthRefresh(page)
      await mockAuthMe(page)
      await page.addInitScript((userId) => {
        localStorage.setItem(
          `marketmind.dashboardOnboarding.v1.${userId}`,
          'dismissed',
        )
      }, mockUser.id)
      await page.goto(`/${locale}/dashboard`)

      await expect(
        page.getByRole('button', { name: /Sign out|تسجيل الخروج/i }),
      ).toBeVisible()
    })

    test('logs out from the mobile header and redirects to login', async ({ page }) => {
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
        .getByRole('button', { name: /Sign out|تسجيل الخروج/i })
        .click()

      await expect(page).toHaveURL(new RegExp(`/${locale}/login`), {
        timeout: 15000,
      })
    })

    test('renders a scrollable primary nav with all six destinations', async ({ page }) => {
      await mockAuthRefresh(page)
      await mockAuthMe(page)
      await page.addInitScript((userId) => {
        localStorage.setItem(
          `marketmind.dashboardOnboarding.v1.${userId}`,
          'dismissed',
        )
      }, mockUser.id)
      await page.goto(`/${locale}/dashboard`)

      const mobileNav = page.getByRole('navigation', {
        name: /Mobile primary|أساسي للجوال/i,
      })
      await expect(mobileNav).toBeVisible({ timeout: 15000 })
      const destinations = [
        { label: /Discovery|الاستكشاف/i, href: '/discovery' },
        { label: /Dashboard|لوحة/i, href: '/dashboard' },
        { label: /Strategy|الاستراتيجية/i, href: '/strategy' },
        { label: /Content|المحتوى/i, href: '/content' },
        { label: /Publishing|النشر/i, href: '/publishing' },
        { label: /Billing|الفوترة/i, href: '/billing' },
      ]
      for (const { label, href } of destinations) {
        const link = mobileNav.getByRole('link', { name: label })
        await expect(link).toHaveCount(1)
        await expect(link).toHaveAttribute('href', `/${locale}${href}`)
      }

      await expect(
        mobileNav.getByRole('link', { name: /Dashboard|لوحة/i }),
      ).toHaveAttribute('aria-current', 'page')

      const ul = mobileNav.locator('ul')
      await expect(ul).toHaveCSS('display', 'flex')
      await expect(ul).toHaveCSS('overflow-x', 'auto')
      expect(
        await ul.evaluate((el) => el.scrollWidth > el.clientWidth),
      ).toBe(true)
      const items = await ul.locator('li').count()
      expect(items).toBe(6)
    })
  })
}
