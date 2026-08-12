import { expect, test } from '@playwright/test'

const landingLocales = [
  {
    locale: 'en',
    title: 'Better marketing starts with understanding your business',
    discoveryCta: 'Start with your business',
    liveStatus: 'Available now',
  },
  {
    locale: 'ar',
    title: 'التسويق الأفضل بيبدأ بفهم نشاطك',
    discoveryCta: 'ابدأ من نشاطك',
    liveStatus: 'متاح الآن',
  },
] as const

for (const landing of landingLocales) {
  test(`presents the current landing journey in ${landing.locale}`, async ({ page }) => {
    await page.goto(`/${landing.locale}`)

    await expect(page.getByRole('heading', { level: 1, name: landing.title })).toBeVisible()
    await expect(page.getByRole('link', { name: landing.discoveryCta }).first()).toHaveAttribute(
      'href',
      `/${landing.locale}/register`,
    )

    const roadmap = page.locator('#roadmap')
    await roadmap.scrollIntoViewIfNeeded()
    await expect(roadmap.locator('article')).toHaveCount(7)
    await expect(roadmap.getByText(landing.liveStatus, { exact: true })).toHaveCount(3)
    await expect(roadmap.getByText(landing.locale === 'en' ? 'Needs connection' : 'محتاج ربط', { exact: true })).toBeVisible()

    await expect(page.locator('#main-content')).toBeVisible()
    await expect(page.locator('#discovery article')).toHaveCount(5)
    await expect(page.locator('#sample .sample-board')).toBeVisible()

    const hasHorizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    )
    expect(hasHorizontalOverflow).toBe(false)
  })
}

test('mobile navigation is an accessible dismissible dialog', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Mobile navigation is only rendered in the mobile project')

  await page.goto('/en')
  const trigger = page.getByRole('button', { name: 'Open menu' })
  await trigger.click()

  const drawer = page.getByRole('dialog', { name: 'Primary navigation' })
  await expect(drawer).toBeVisible()
  await expect(drawer.getByRole('link').first()).toBeFocused()

  await page.keyboard.press('Escape')
  await expect(drawer).toBeHidden()
  await expect(trigger).toBeFocused()
})

test('desktop authentication actions share the same visual bounds', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Desktop authentication actions are hidden in the mobile project')

  await page.goto('/en')
  const nav = page.getByRole('navigation', { name: 'Primary navigation' })
  const login = nav.getByRole('link', { name: 'Log in' })
  const createAccount = nav.getByRole('link', { name: 'Create account' })

  const [loginBounds, createAccountBounds] = await Promise.all([
    login.evaluate((element) => {
      const { height, y } = element.getBoundingClientRect()
      return { height, y }
    }),
    createAccount.evaluate((element) => {
      const { height, y } = element.getBoundingClientRect()
      return { height, y }
    }),
  ])

  expect(createAccountBounds.height).toBe(loginBounds.height)
  expect(createAccountBounds.y).toBe(loginBounds.y)
})

test.describe('Reduced motion', () => {
  test('shows one static, readable capability list', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/en')
    expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(
      true,
    )

    const clones = page.locator('.capability-marquee-clone')
    await expect(clones).toHaveCount(12)
    expect(
      await clones.evaluateAll((elements) =>
        elements.every((element) => getComputedStyle(element).display === 'none'),
      ),
    ).toBe(true)
    expect(
      await page.locator('.capability-marquee-track').evaluateAll((elements) =>
        elements.every((element) => getComputedStyle(element).animationName === 'none'),
      ),
    ).toBe(true)
  })
})
