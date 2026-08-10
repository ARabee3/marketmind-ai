import { expect, test } from '@playwright/test'

const locales = ['en', 'ar'] as const

for (const locale of locales) {
  test(`renders a localized 404 for an unknown ${locale} route`, async ({ page }) => {
    const response = await page.goto(`/${locale}/route-that-does-not-exist`)

    expect(response?.status()).toBe(404)
    await expect(
      page.getByRole('heading', {
        level: 1,
        name: locale === 'ar' ? 'الرحلة دي بتقف هنا.' : 'This journey stops here.',
      }),
    ).toBeVisible()
    await expect(
      page.getByRole('link', {
        name: locale === 'ar' ? 'الذهاب إلى لوحة التحكم' : 'Go to dashboard',
      }),
    ).toHaveAttribute('href', `/${locale}/dashboard`)
    await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr')
  })
}
