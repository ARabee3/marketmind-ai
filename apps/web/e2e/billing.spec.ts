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

const transactions: readonly BillingTransactionResponse[] = []

test.describe('Billing owner journey', () => {
  test('buys a points bundle and sees the new balance after returning from checkout', async ({
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

    // Clicking buy creates the checkout and redirects to the hosted page.
    await page.route('https://hosted-checkout.example/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<html><body>hosted checkout</body></html>',
      })
    })
    await page.getByRole('button', { name: 'Buy for EGP 200' }).click()
    await page.waitForURL('**/hosted-checkout.example/**')
    expect(billing.checkoutBodies).toHaveLength(1)
    expect(billing.checkoutBodies[0].bundle_code).toBe('growth_300')

    // Paymob returns the owner to the billing page; the wallet refetches.
    await page.goto('/en/billing')
    await expect(page.getByText('You have 365 points')).toBeVisible()
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
  const checkoutBodies: Array<{ bundle_code: string }> = []

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
      await json(
        route,
        paid
          ? {
              ...wallet,
              balance: 365,
              lifetime_granted: 365,
              low_balance: false,
            }
          : wallet,
      )
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
                points: 300,
                balance_after: 365,
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
      checkoutBodies.push((await request.postDataJSON()) as { bundle_code: string })
      paid = true
      await json(
        route,
        {
          checkout_attempt_id: 'attempt-1',
          status: 'pending',
          checkout_url: 'https://hosted-checkout.example/pay?clientSecret=cs_1',
          provider: 'paymob',
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

    await json(route, { code: 'NOT_FOUND' }, 404)
  })

  return { checkoutBodies }
}

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  })
}
