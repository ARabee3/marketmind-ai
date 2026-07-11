import { test, expect } from '@playwright/test'
import { mockAuthRefresh, mockAuthMe, mockUser } from './fixtures/auth'

test.describe('Locale rendering', () => {
  test('renders English page under /en', async ({ page }) => {
    await page.goto('/en')
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr')
    await expect(page.locator('h1')).toContainText('MarketMind AI')
  })

  test('renders Arabic page under /ar', async ({ page }) => {
    await page.goto('/ar')
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar')
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
    await expect(page.locator('h1')).toContainText('ماركت مايند')
  })
})

test.describe('Locale detection (proxy.ts)', () => {
  test('honors Accept-Language: en and redirects unprefixed / to /en', async ({ browser }) => {
    const context = await browser.newContext({ locale: 'en-US' })
    const page = await context.newPage()
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await expect(page).toHaveURL(/\/en(\b|$)/)
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr')
    await context.close()
  })

  test('honors Accept-Language: ar and redirects unprefixed / to /ar', async ({ browser }) => {
    const context = await browser.newContext({ locale: 'ar-EG' })
    const page = await context.newPage()
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await expect(page).toHaveURL(/\/ar(\b|$)/)
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar')
    await context.close()
  })

  test('NEXT_LOCALE cookie overrides Accept-Language', async ({ browser }) => {
    const context = await browser.newContext({ locale: 'en-US' })
    await context.addCookies([
      { name: 'NEXT_LOCALE', value: 'ar', url: 'http://localhost:3000' },
    ])
    const page = await context.newPage()
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await expect(page).toHaveURL(/\/ar(\b|$)/)
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar')
    await context.close()
  })

  test('preserves nested path when redirecting unprefixed URL', async ({ browser }) => {
    const context = await browser.newContext({ locale: 'en-US' })
    const page = await context.newPage()
    await page.goto('/register', { waitUntil: 'domcontentloaded' })
    await expect(page).toHaveURL(/\/en\/register(\b|$)/)
    await context.close()
  })
})

test.describe('Language switcher preserves route (both directions)', () => {
  test('switches /en -> /ar', async ({ page }) => {
    await page.goto('/en')
    await page.getByRole('button', { name: /Arabic|العربية/i }).click()
    await expect(page).toHaveURL(/\/ar(\b|$)/)
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar')
  })

  test('switches /ar -> /en', async ({ page }) => {
    await page.goto('/ar')
    await page.getByRole('button', { name: /English|الإنجليزية/i }).click()
    await expect(page).toHaveURL(/\/en(\b|$)/)
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  })

  test('preserves nested route /en/register -> /ar/register', async ({ page }) => {
    await page.goto('/en/register')
    await page.getByRole('button', { name: /Arabic|العربية/i }).click()
    await expect(page).toHaveURL(/\/ar\/register(\b|$)/)
  })

  test('preserves nested route /ar/register -> /en/register', async ({ page }) => {
    await page.goto('/ar/register')
    await page.getByRole('button', { name: /English|الإنجليزية/i }).click()
    await expect(page).toHaveURL(/\/en\/register(\b|$)/)
  })

  test('preserves nested route /en/discovery -> /ar/discovery', async ({ page }) => {
    await mockAuthRefresh(page)
    await mockAuthMe(page, mockUser)
    await page.goto('/en/discovery')
    await page.getByRole('button', { name: /Arabic|العربية/i }).click()
    await expect(page).toHaveURL(/\/ar\/discovery(\b|$)/)
  })

  test('preserves nested route /ar/discovery -> /en/discovery', async ({ page }) => {
    await mockAuthRefresh(page)
    await mockAuthMe(page, mockUser)
    await page.goto('/ar/discovery')
    await page.getByRole('button', { name: /English|الإنجليزية/i }).click()
    await expect(page).toHaveURL(/\/en\/discovery(\b|$)/)
  })
})

test.describe('Responsive shell', () => {
  for (const locale of ['en', 'ar'] as const) {
    test(`does not overflow horizontally at 1280px in ${locale}`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 })
      await page.goto(`/${locale}`)

      const hasHorizontalOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      )

      expect(hasHorizontalOverflow).toBe(false)
    })
  }
})
