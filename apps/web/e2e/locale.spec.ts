import { test, expect } from '@playwright/test'

test.describe('Locale routing', () => {
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

  test('language switcher preserves route', async ({ page }) => {
    await page.goto('/en')
    await page.getByRole('button').click()
    await expect(page).toHaveURL(/\/ar/)
  })
})
