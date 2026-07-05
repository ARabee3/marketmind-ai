import { test, expect } from '@playwright/test'

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
    await page.goto('/auth', { waitUntil: 'domcontentloaded' })
    await expect(page).toHaveURL(/\/en\/auth(\b|$)/)
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

  test('preserves nested route /en/auth -> /ar/auth', async ({ page }) => {
    await page.goto('/en/auth')
    await page.getByRole('button', { name: /Arabic|العربية/i }).click()
    await expect(page).toHaveURL(/\/ar\/auth(\b|$)/)
  })

  test('preserves nested route /ar/auth -> /en/auth', async ({ page }) => {
    await page.goto('/ar/auth')
    await page.getByRole('button', { name: /English|الإنجليزية/i }).click()
    await expect(page).toHaveURL(/\/en\/auth(\b|$)/)
  })

  test('preserves nested route /en/discovery -> /ar/discovery', async ({ page }) => {
    await page.goto('/en/discovery')
    await page.getByRole('button', { name: /Arabic|العربية/i }).click()
    await expect(page).toHaveURL(/\/ar\/discovery(\b|$)/)
  })

  test('preserves nested route /ar/discovery -> /en/discovery', async ({ page }) => {
    await page.goto('/ar/discovery')
    await page.getByRole('button', { name: /English|الإنجليزية/i }).click()
    await expect(page).toHaveURL(/\/en\/discovery(\b|$)/)
  })
})