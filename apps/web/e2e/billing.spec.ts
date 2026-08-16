import { expect, test, type Page, type Route } from '@playwright/test'
import type {
  BillingPointBundle,
  BillingPointLedgerEntry,
  BillingTransactionResponse,
  BillingWalletResponse,
} from '@marketmind/contracts'
import { mockAccessToken, mockAuthMe, mockAuthRefresh } from './fixtures/auth'

const bundles: readonly BillingPointBundle[] = [
  {
    code: 'starter_150',
    points: 150,
    amount_egp: 100,
    currency: 'EGP',
    display_name_en: 'Starter',
    display_name_ar: 'مبتدئ',
  },
  {
    code: 'growth_300',
    points: 300,
    amount_egp: 200,
    currency: 'EGP',
    display_name_en: 'Growth',
    display_name_ar: 'نمو',
  },
  {
    code: 'pro_500',
    points: 500,
    amount_egp: 300,
    currency: 'EGP',
    display_name_en: 'Pro',
    display_name_ar: 'احترافي',
  },
]

const wallet: BillingWalletResponse = {
  billing_account_id: 'billing-account-1',
  balance: 65,
  lifetime_granted: 65,
  lifetime_spent: 0,
  low_balance: true,
}

const ledger: readonly BillingPointLedgerEntry[] = [
  {
    id: 'ledger-1',
    direction: 'credit',
    reason: 'trial_grant',
    metric: null,
    points: 65,
    balance_after: 65,
    created_at: '2026-08-01T08:00:00.000Z',
  },
]

const transactions: readonly BillingTransactionResponse[] = [
  {
    id: 'transaction-1',
    kind: 'charge',
    status: 'succeeded',
    amount_egp: 200,
    currency: 'EGP',
    provider: 'fake',
    payment_mode: 'one_time_card',
    occurred_at: '2026-08-05T10:00:00.000Z',
  },
]

test.describe('Billing owner journey', () => {
  test('shows the points wallet and confirms a sandbox top-up', async ({
    page,
  }) => {
    await authenticate(page)
    const billing = await mockBillingApi(page)

    await page.goto('/en/billing')

    await expect(
      page.getByRole('heading', {
        level: 1,
        name: 'Points for your growth work',
      }),
    ).toBeVisible()
    await expect(page.getByText('You have 65 points')).toBeVisible()
    await expect(page.getByRole('status')).toContainText('Balance running low')
    await expect(
      page.getByRole('heading', { level: 2, name: 'Points bundles' }),
    ).toBeVisible()
    await expect(
      page.getByRole('heading', { level: 2, name: 'Points history' }),
    ).toBeVisible()
    await expect(page.getByText('Welcome bonus')).toBeVisible()

    await page.getByRole('button', { name: 'Buy for EGP 200' }).click()
    await expect(page.getByRole('status')).toContainText('Sandbox payment')
    await page.getByRole('button', { name: 'Confirm sandbox payment' }).click()

    await expect.poll(() => billing.confirmations).toEqual(['paid'])
    await expect(page.getByText('You have 215 points')).toBeVisible()
    await expect(page.getByText('Points purchased')).toBeVisible()
  })

  test('keeps the billing journey usable in Arabic RTL', async ({
    page,
  }, testInfo) => {
    await authenticate(page)
    await mockBillingApi(page)

    await page.goto('/ar/billing')

    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
    await expect(
      page.getByRole('heading', { level: 1, name: 'نقاط لشغل النمو بتاعك' }),
    ).toBeVisible()
    await expect(page.getByText('عندك 65 نقطة')).toBeVisible()

    if (testInfo.project.name === 'mobile-chrome') {
      await expect(
        page
          .getByRole('navigation', { name: 'أساسي للجوال' })
          .getByRole('link', { name: 'الفوترة' }),
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

    if (path.endsWith('/billing/bundles') && method === 'GET') {
      await json(route, {
        version: 'billing-bundles-v1',
        currency: 'EGP',
        bundles,
      })
      return
    }
    if (path.endsWith('/billing/wallet') && method === 'GET') {
      await json(route, paid ? { ...wallet, balance: 215, lifetime_granted: 215, low_balance: false } : wallet)
      return
    }
    if (path.endsWith('/billing/wallet/ledger') && method === 'GET') {
      await json(route, {
        entries: paid
          ? [
              ...ledger,
              {
                id: 'ledger-2',
                direction: 'credit',
                reason: 'topup',
                metric: null,
                points: 150,
                balance_after: 215,
                created_at: '2026-08-05T11:00:00.000Z',
              },
            ]
          : ledger,
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
          amount_egp: 200,
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

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  })
}
