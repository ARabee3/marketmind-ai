import { expect, test, type Page, type Route } from '@playwright/test'
import type { PerformanceOverviewV1, PerformancePostProjectionV1 } from '@marketmind/contracts'
import { PUBLISHING_JOURNEY_FIXTURE } from '../src/features/publishing/lib/publishing-fixtures'
import { mockAccessToken, mockAuthMe, mockAuthRefresh } from './fixtures/auth'

const locales = ['en', 'ar'] as const

for (const locale of locales) {
  test.describe(`Content performance (${locale})`, () => {
    test('guides a first-time owner to the strategy and publishing flow instead of an error', async ({ page }) => {
      await authenticate(page)
      await page.route('**/journey/current', async (route) => {
        await json(route, {
          ...PUBLISHING_JOURNEY_FIXTURE,
          journey: { state: 'no_journey', discovery: null, profile: null },
          future_phase: {
            phase: 'strategy',
            availability: 'unavailable',
            status: 'needs_brief',
            reason: 'discovery_required',
            destination: null,
          },
          primary_action: { type: 'start_discovery', destination: '/discovery/new' },
          content: {
            ready: false,
            reason: 'no_cycle',
            cycle: null,
            pack: null,
          },
        })
      })

      await page.goto(`/${locale}/performance`)

      await expect(
        page.getByRole('heading', {
          name: locale === 'ar' ? 'كمّل ملف نشاطك الأول' : 'Complete your business profile first',
        }),
      ).toBeVisible()
      await expect(
        page.getByRole('link', {
          name: locale === 'ar' ? 'ابدأ رحلة الاستكشاف' : 'Start business discovery',
        }),
      ).toHaveAttribute('href', new RegExp(`/${locale}/discovery/new$`))
      await expect(
        page.getByText(
          locale === 'ar'
            ? 'ماقدرناش نحمل أدلة المتابعة. المحتوى المنشور بتاعك مااتغيرش'
            : 'We could not load the monitoring evidence',
        ),
      ).not.toBeVisible()
      expect(await page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr')
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    })

    test('renders the real-evidence rail and keeps the page within the viewport', async ({ page }) => {
      await authenticate(page)
      await mockPerformanceApi(page)

      await page.goto(`/${locale}/performance`)

      await expect(
        page.getByRole('heading', {
          level: 1,
          name: locale === 'ar' ? 'شوف منشوراتك المنشورة بتعلمك إيه' : 'See what your published posts are teaching you',
        }),
      ).toBeVisible()
      await expect(page.getByRole('heading', { level: 2, name: locale === 'ar' ? 'منشور فيسبوك منشور' : 'Published Facebook post' })).toBeVisible()
      await expect(page.getByText(locale === 'ar' ? 'أدلة كفاية للمقارنة' : 'Enough evidence for comparison')).toBeVisible()
      await expect(
        page.getByRole('heading', {
          name: locale === 'ar' ? 'مشاهدات الفيديو والتصاميم' : 'Media views',
          exact: true,
        }),
      ).toBeVisible()
      await expect(page.getByText('12', { exact: true }).last()).toBeVisible()
      await expect(page.getByText('0', { exact: true }).last()).toBeVisible()
      await expect(
        page.getByText(locale === 'ar' ? 'غير متاح' : 'Unavailable', { exact: true }).last(),
      ).toBeVisible()
      await expect(page.locator('html')).toHaveAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr')
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    })

    test('keeps the monitoring connection recovery action visible', async ({ page }) => {
      await authenticate(page)
      await mockJourney(page)
      await page.route('**/performance/facebook/overview', async (route) => {
        await json(route, {
          ...overview(),
          capability: {
            status: 'blocked',
            blockers: ['read_insights_permission_missing'],
            last_successful_sync: null,
          },
        })
      })

      await page.goto(`/${locale}/performance`)

      await expect(
        page.getByText(
          locale === 'ar'
            ? 'صلاحية إحصاءات فيسبوك ناقصة.'
            : 'Facebook Insights permission is missing.',
        ),
      ).toBeVisible()
      await expect(
        page
          .getByRole('link', {
            name: locale === 'ar' ? 'أعد ربط فيسبوك' : 'Reconnect Facebook',
          })
          .first(),
      ).toHaveAttribute('href', new RegExp(`/${locale}/connections$`))
    })
  })
}

test.use({ viewport: { width: 375, height: 800 } })

test('mobile Performance navigation is reachable and scrolls without horizontal page overflow', async ({ page }) => {
  await authenticate(page)
  await mockPerformanceApi(page)
  await page.goto('/en/performance')

  const mobileNav = page.getByRole('navigation', { name: 'Mobile primary' })
  await expect(mobileNav.getByRole('link', { name: 'Content performance' })).toHaveAttribute(
    'aria-current',
    'page',
  )
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

async function authenticate(page: Page) {
  await mockAuthRefresh(page, mockAccessToken)
  await mockAuthMe(page)
}

async function mockJourney(page: Page) {
  await page.route('**/journey/current', async (route) => {
    await json(route, {
      ...PUBLISHING_JOURNEY_FIXTURE,
      content: {
        ...PUBLISHING_JOURNEY_FIXTURE.content,
        cycle: { ...PUBLISHING_JOURNEY_FIXTURE.content!.cycle!, current_week: 1 },
      },
    })
  })
}

async function mockPerformanceApi(page: Page) {
  await mockJourney(page)
  await page.route('**/performance/facebook/overview', async (route) => {
    await json(route, overview())
  })
  await page.route('**/performance/facebook/posts/*/refresh', async (route, request) => {
    if (request.method() !== 'POST') {
      await route.fallback()
      return
    }
    await json(route, { status: 'queued', windows: [] })
  })
}

function overview(): PerformanceOverviewV1 {
  return {
    contract_version: 'performance-v1',
    business_id: 'a1000000-0000-4000-8000-000000000001',
    provider: 'facebook',
    generated_at: '2026-08-19T08:00:01.000Z',
    posts: [post()],
    baseline: {
      status: 'not_ready',
      observed_snapshot_count: 1,
      required_snapshot_count: 3,
      reason: 'insufficient_snapshots',
    },
    capability: {
      status: 'ready',
      blockers: [],
      last_successful_sync: '2026-08-19T08:00:01.000Z',
    },
  }
}

function post(): PerformancePostProjectionV1 {
  const businessId = 'a1000000-0000-4000-8000-000000000001'
  const resultId = 'a1000000-0000-4000-8000-000000000003'
  return {
    contract_version: 'performance-v1',
    business_id: businessId,
    candidate_id: 'a1000000-0000-4000-8000-000000000002',
    publishing_result_id: resultId,
    provider: 'facebook',
    provider_object_id: 'page-1_post-1',
    published_at: '2026-08-18T08:00:00.000Z',
    snapshots: [
      {
        contract_version: 'performance-v1',
        snapshot_id: 'a1000000-0000-4000-8000-000000000004',
        business_id: businessId,
        publishing_result_id: resultId,
        provider: 'facebook',
        provider_object_id: 'page-1_post-1',
        window: '24h',
        published_at: '2026-08-18T08:00:00.000Z',
        observed_at: '2026-08-19T08:00:00.000Z',
        fetched_at: '2026-08-19T08:00:01.000Z',
        metrics: {
          post_media_view: { status: 'available', value: 12 },
          post_total_media_view_unique: { status: 'available', value: 0 },
          post_clicks: { status: 'unavailable', reason: 'not_returned' },
        },
      },
    ],
    sync_windows: [],
  }
}

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  })
}
