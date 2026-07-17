import { test, expect } from '@playwright/test'
import { mockAccessToken, mockAuthMe, mockAuthRefresh, mockUser } from './fixtures/auth'
import {
  authAndJourney,
  responseWithActiveDiscovery,
  responseWithConfirmedProfile,
  responseWithNoJourney,
  responseWithSummaryReview,
} from './fixtures/dashboard'

const locales = ['en', 'ar'] as const

for (const locale of locales) {
  test.describe(`Dashboard (${locale})`, () => {
    test('shows a start action when there is no journey', async ({ page }) => {
      await authAndJourney(page, responseWithNoJourney())

      await page.goto(`/${locale}/dashboard`)

      await expect(page.getByRole('heading', { name: title(locale, 'empty') })).toBeVisible()
      await expect(page.getByRole('link', { name: action(locale, 'start') })).toHaveAttribute(
        'href',
        new RegExp(`/${locale}/discovery/new$`),
      )
    })

    test('shows a resume action for an active discovery', async ({ page }) => {
      await authAndJourney(page, responseWithActiveDiscovery('ready_for_chat'))

      await page.goto(`/${locale}/dashboard`)

      await expect(page.getByRole('heading', { name: title(locale, 'active') })).toBeVisible()
      await expect(page.getByText('Nile Sweets')).toBeVisible()
      await expect(page.getByRole('link', { name: action(locale, 'continue') })).toHaveAttribute(
        'href',
        new RegExp(`/${locale}/discovery/session-id$`),
      )
    })

    test('shows profile review as the required owner gate', async ({ page }) => {
      await authAndJourney(page, responseWithSummaryReview())

      await page.goto(`/${locale}/dashboard`)

      await expect(page.getByRole('heading', { name: title(locale, 'review') })).toBeVisible()
      await expect(page.getByText(strategyText(locale, 'review'))).toBeVisible()
    })

    test('shows confirmed profile context without linking to Strategy', async ({ page }) => {
      await authAndJourney(page, responseWithConfirmedProfile())

      await page.goto(`/${locale}/dashboard`)

      await expect(page.getByRole('heading', { name: title(locale, 'confirmed') })).toBeVisible()
      await expect(page.getByText(locale === 'ar' ? 'الإصدار 2' : 'Version 2')).toBeVisible()
      await expect(page.getByText(strategyText(locale, 'inactive'))).toBeVisible()
      await expect(page.getByRole('link', { name: /Strategy|الاستراتيجية/ })).toHaveCount(0)
    })

    test('shows a recovery state when the journey endpoint fails', async ({ page }) => {
      await mockAuthRefresh(page, mockAccessToken)
      await mockAuthMe(page)
      await page.route('**/journey/current', async (route) => {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: { code: 'INTERNAL_ERROR' } }),
        })
      })

      await page.goto(`/${locale}/dashboard`)

      await expect(page.getByText(loadError(locale))).toBeVisible()
      await expect(page.getByRole('button', { name: retry(locale) })).toBeVisible()
    })

    test('shows first-use onboarding and lets the owner start', async ({ page }) => {
      await authAndJourney(page, responseWithNoJourney())

      await page.goto(`/${locale}/dashboard`)

      const dialog = page.getByRole('dialog')
      await expect(dialog).toBeVisible()
      await expect(page.getByRole('heading', { name: onboardingTitle(locale, 'control') })).toBeVisible()
      await page.getByRole('button', { name: onboardingNext(locale) }).click()
      await expect(page.getByRole('heading', { name: onboardingTitle(locale, 'profile') })).toBeVisible()
      await page.getByRole('button', { name: onboardingNext(locale) }).click()
      await page.getByRole('button', { name: onboardingNext(locale) }).click()
      await expect(page.getByRole('heading', { name: onboardingTitle(locale, 'confirm') })).toBeVisible()
      await page.getByRole('button', { name: onboardingStart(locale) }).click()

      await expect(dialog).toHaveCount(0)
      await expect(
        page.evaluate((userId) => {
          return localStorage.getItem(`marketmind.dashboardOnboarding.v1.${userId}`)
        }, mockUser.id),
      ).resolves.toBe('dismissed')
    })
  })
}

function title(locale: 'en' | 'ar', key: 'empty' | 'active' | 'review' | 'confirmed') {
  const values = {
    en: {
      empty: 'Start Discovery',
      active: 'Continue Discovery',
      review: 'Review the business profile',
      confirmed: 'Discovery is confirmed',
    },
    ar: {
      empty: 'ابدأ الاستكشاف',
      active: 'كمّل الاستكشاف',
      review: 'راجع ملف النشاط',
      confirmed: 'تم تأكيد الاستكشاف',
    },
  }
  return values[locale][key]
}

function action(locale: 'en' | 'ar', key: 'start' | 'continue') {
  const values = {
    en: { start: 'Start Discovery', continue: 'Continue Discovery' },
    ar: { start: 'ابدأ الاستكشاف', continue: 'كمّل الاستكشاف' },
  }
  return values[locale][key]
}

function strategyText(locale: 'en' | 'ar', key: 'review' | 'inactive') {
  const values = {
    en: {
      review: 'Strategy stays locked until you confirm the profile.',
      inactive: 'Strategy is planned next, but not available in this sprint.',
    },
    ar: {
      review: 'الاستراتيجية تظل مغلقة حتى تؤكد ملف النشاط.',
      inactive: 'الاستراتيجية مخططة كمرحلة تالية، لكنها غير متاحة في هذا السبرنت.',
    },
  }
  return values[locale][key]
}

function loadError(locale: 'en' | 'ar') {
  return locale === 'ar'
    ? 'تعذر تحميل آخر رحلة. يمكنك بدء استكشاف جديد أو المحاولة مرة أخرى.'
    : 'We could not load your latest journey. You can start a new Discovery or try again.'
}

function retry(locale: 'en' | 'ar') {
  return locale === 'ar' ? 'إعادة المحاولة' : 'Try again'
}

function onboardingNext(locale: 'en' | 'ar') {
  return locale === 'ar' ? 'التالي' : 'Next'
}

function onboardingStart(locale: 'en' | 'ar') {
  return locale === 'ar' ? 'ابدأ' : 'Start'
}

function onboardingTitle(
  locale: 'en' | 'ar',
  key: 'control' | 'profile' | 'confirm',
) {
  const values = {
    en: {
      control: 'You stay in control',
      profile: 'Build the business profile first',
      confirm: 'Confirm before the next phase',
    },
    ar: {
      control: 'أنت المتحكم في القرار',
      profile: 'نبني ملف النشاط أولًا',
      confirm: 'أكد قبل المرحلة التالية',
    },
  }
  return values[locale][key]
}
