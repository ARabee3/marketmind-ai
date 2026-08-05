import { expect, test, type Page, type Route } from '@playwright/test'
import type {
  BillingCatalogPrice,
  BillingSubscriptionResponse,
  BillingTransactionResponse,
  BillingUsageMetric,
} from '@marketmind/contracts'
import { mockAccessToken, mockAuthMe, mockAuthRefresh } from './fixtures/auth'

const growthEntitlements: BillingCatalogPrice['entitlements'] = {
  business_count: 1,
  strategy_cycles: 1,
  strategy_revisions_per_cycle: 1,
  content_items_rolling_30d: 20,
  static_images_per_period: 12,
  content_revisions_per_item: 2,
  connected_targets: 2,
}

const monthlyPrice = {
  code: 'growth_monthly_v1',
  plan_code: 'growth',
  interval: 'monthly',
  amount_egp: 299,
  currency: 'EGP',
  period_days: 30,
  public: true,
  display_name_en: 'Growth',
  display_name_ar: 'نمو',
  entitlements: growthEntitlements,
} satisfies BillingCatalogPrice

const yearlyPrice = {
  code: 'growth_yearly_v1',
  plan_code: 'growth',
  interval: 'yearly',
  amount_egp: 2990,
  currency: 'EGP',
  period_days: 365,
  public: true,
  display_name_en: 'Growth yearly',
  display_name_ar: 'نمو سنوي',
  entitlements: growthEntitlements,
} satisfies BillingCatalogPrice

const usage: readonly BillingUsageMetric[] = [
  {
    metric: 'content_item',
    used: 4,
    limit: 20,
    remaining: 16,
    period_start: '2026-08-01T00:00:00.000Z',
    period_end: '2026-08-31T00:00:00.000Z',
  },
]

const transactions: readonly BillingTransactionResponse[] = [
  {
    id: 'transaction-1',
    kind: 'charge',
    status: 'succeeded',
    amount_egp: 299,
    currency: 'EGP',
    provider: 'fake',
    payment_mode: 'one_time_card',
    occurred_at: '2026-08-05T10:00:00.000Z',
  },
]

test.describe('Billing owner journey', () => {
  test('shows owner-controlled pricing and confirms a sandbox checkout', async ({
    page,
  }) => {
    await authenticate(page)
    const billing = await mockBillingApi(page)

    await page.goto('/en/billing')

    await expect(
      page.getByRole('heading', {
        level: 1,
        name: 'Keep your growth work moving',
      }),
    ).toBeVisible()
    await expect(
      page.getByRole('heading', { level: 2, name: 'Growth' }),
    ).toBeVisible()
    await expect(page.getByText('4 of 20')).toBeVisible()
    await expect(
      page.getByRole('heading', { level: 2, name: 'Payment history' }),
    ).toBeVisible()
    await expect(page.getByText('Charge')).toBeVisible()

    await page.getByRole('button', { name: 'Start monthly checkout' }).click()
    await expect(page.getByRole('status')).toContainText('Sandbox payment')
    await page.getByRole('button', { name: 'Confirm sandbox payment' }).click()

    await expect.poll(() => billing.confirmations).toEqual(['paid'])
    await expect(
      page.getByRole('heading', { level: 2, name: 'Growth is active' }),
    ).toBeVisible()
    await expect(page.getByRole('status')).toHaveCount(0)
  })

  test('keeps the billing journey usable in Arabic RTL', async ({
    page,
  }, testInfo) => {
    await authenticate(page)
    await mockBillingApi(page)

    await page.goto('/ar/billing')

    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
    await expect(
      page.getByRole('heading', { level: 1, name: 'كمّل شغل النمو بتاعك' }),
    ).toBeVisible()
    await expect(
      page.getByRole('heading', { level: 2, name: 'نمو' }),
    ).toBeVisible()

    if (testInfo.project.name === 'mobile-chrome') {
      await page.getByRole('button', { name: 'فتح التنقل' }).click()
      await expect(
        page.getByRole('dialog').getByRole('link', { name: 'الفوترة' }),
      ).toHaveAttribute('aria-current', 'page')
    } else {
      await expect(page.getByRole('link', { name: 'الفوترة' })).toHaveAttribute(
        'aria-current',
        'page',
      )
    }
  })
})

async function authenticate(page: Page) {
  await mockAuthRefresh(page, mockAccessToken)
  await mockAuthMe(page)
}

async function mockBillingApi(page: Page) {
  let paid = false
  const confirmations: Array<'paid' | 'failed' | 'pending'> = []

  await page.route('**/api/v1/billing/**', async (route, request) => {
    const path = new URL(request.url()).pathname
    const method = request.method()

    if (path.endsWith('/billing/prices') && method === 'GET') {
      await json(route, {
        version: 'billing-v1',
        currency: 'EGP',
        prices: [monthlyPrice, yearlyPrice],
      })
      return
    }
    if (path.endsWith('/billing/subscription') && method === 'GET') {
      await json(route, subscription(paid))
      return
    }
    if (path.endsWith('/billing/usage') && method === 'GET') {
      await json(route, {
        state: paid ? 'active' : 'trialing',
        plan_code: paid ? 'growth' : 'trial',
        metrics: usage,
      })
      return
    }
    if (path.endsWith('/billing/transactions') && method === 'GET') {
      await json(route, { transactions })
      return
    }
    if (path.endsWith('/billing/checkouts') && method === 'POST') {
      await json(
        route,
        {
          checkout_attempt_id: 'attempt-1',
          status: 'pending',
          checkout_url: 'http://sandbox.test/checkout',
          provider: 'fake',
          provider_checkout_ref: 'fake_checkout_1',
          amount_egp: monthlyPrice.amount_egp,
          currency: 'EGP',
          expires_at: '2026-08-05T11:00:00.000Z',
          sandbox: true,
        },
        201,
      )
      return
    }
    if (path.endsWith('/billing/sandbox/confirm') && method === 'POST') {
      const body = (await request.postDataJSON()) as {
        outcome: 'paid' | 'failed' | 'pending'
      }
      confirmations.push(body.outcome)
      paid = body.outcome === 'paid'
      await json(route, { accepted: true, duplicate: false })
      return
    }

    await json(route, { code: 'NOT_FOUND' }, 404)
  })

  return { confirmations }
}

function subscription(paid: boolean): BillingSubscriptionResponse {
  return {
    billing_account_id: 'billing-account-1',
    state: paid ? 'active' : 'trialing',
    plan_code: paid ? 'growth' : 'trial',
    price_code: paid ? 'growth_monthly_v1' : 'trial_14d_v1',
    amount_egp: paid ? 299 : 0,
    currency: 'EGP',
    renewal_mode: paid ? 'recurring_card' : 'none',
    paid_through_at: paid ? '2026-09-05T10:00:00.000Z' : null,
    grace_ends_at: null,
    trial_ends_at: paid ? null : '2026-08-19T10:00:00.000Z',
    cancel_at_period_end: false,
    payment_provider: paid ? 'fake' : null,
    masked_payment_method: paid ? '**** 4242' : null,
  }
}

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  })
}
