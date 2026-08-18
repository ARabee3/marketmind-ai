import { expect, test } from '@playwright/test'

const landingLocales = [
  {
    locale: 'en',
    title: 'Your marketing plan and weekly posts, ready in one place.',
    discoveryCta: 'Start my plan',
    completedLoop: 'Closed-loop growth engine',
    plannedLabel: 'Planned next',
    sampleOutcome: 'Ready Facebook Posts',
  },
  {
    locale: 'ar',
    title: 'خطة تسويق لـ ١٢ أسبوع وبوستات أسبوعية جاهزة لصفحتك.',
    discoveryCta: 'ابدأ خطتي التسويقية',
    completedLoop: 'تطوير تسويقي مستمر',
    plannedLabel: 'مخطط بعد كده',
    sampleOutcome: '٤. بوستات الفيسبوك جاهزة',
  },
] as const

for (const landing of landingLocales) {
  test(`presents the current landing journey in ${landing.locale}`, async ({ page }) => {
    await page.goto(`/${landing.locale}`)

    await expect(page.getByRole('heading', { level: 1, name: landing.title })).toBeVisible()
    const brandLockup = page.getByRole('img', { name: 'MarketMind' }).first()
    await expect(brandLockup).toBeVisible()

    const brandAlignment = await brandLockup.evaluate((element) => {
      const mark = element.querySelector('svg')?.getBoundingClientRect()
      const wordmark = element
        .querySelector('span[aria-hidden="true"]')
        ?.getBoundingClientRect()

      if (!mark || !wordmark) return null

      return {
        horizontalGap: wordmark.x - (mark.x + mark.width),
        centerDelta: Math.abs(mark.y + mark.height / 2 - (wordmark.y + wordmark.height / 2)),
      }
    })

    expect(brandAlignment).not.toBeNull()
    expect(brandAlignment?.horizontalGap).toBeGreaterThanOrEqual(3.5)
    expect(brandAlignment?.horizontalGap).toBeLessThanOrEqual(4.5)
    expect(brandAlignment?.centerDelta).toBeLessThanOrEqual(0.5)
    await expect(page.getByRole('link', { name: landing.discoveryCta }).first()).toHaveAttribute(
      'href',
      `/${landing.locale}/register`,
    )

    await expect(page.locator('#main-content')).toBeVisible()
    const journey = page.locator('#how-it-works')
    await expect(journey.locator('article')).toHaveCount(5)
    await expect(journey.getByText(landing.completedLoop, { exact: true })).toBeVisible()
    await expect(page.getByText(landing.plannedLabel, { exact: true })).toHaveCount(0)

    const agents = page.locator('#agents')
    await expect(agents).toBeVisible()
    await expect(agents.locator('[role="tab"]')).toHaveCount(6)

    await expect(page.locator('#sample .sample-board')).toBeVisible()
    await expect(page.locator('#sample').getByText(landing.sampleOutcome, { exact: false })).toBeVisible()

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
  test('keeps the marketing runway static and readable', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/en')
    expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(
      true,
    )

    const activeWeek = page.locator('.marketing-week-active')
    await expect(activeWeek).toBeVisible()
    const motion = await activeWeek.evaluate((element) => {
      const style = getComputedStyle(element, '::after')
      return {
        name: style.animationName,
      }
    })
    expect(['none', '']).toContain(motion.name)
  })
})
