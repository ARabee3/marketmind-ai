import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  cancelBillingSubscription,
  createBillingCheckout,
  getBillingPrices,
} from '@/lib/api/billing'

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }))

vi.mock('@/lib/api/client', () => ({
  apiRequest,
}))

describe('billing API client', () => {
  beforeEach(() => {
    apiRequest.mockReset()
  })

  it('reads the server-controlled EGP catalog', async () => {
    apiRequest.mockResolvedValue(
      new Response(
        JSON.stringify({ version: 'billing-v1', currency: 'EGP', prices: [] }),
        { status: 200 },
      ),
    )

    await expect(getBillingPrices()).resolves.toEqual({
      version: 'billing-v1',
      currency: 'EGP',
      prices: [],
    })
    expect(apiRequest).toHaveBeenCalledWith('/billing/prices', undefined)
  })

  it('sends the same idempotency key in the header and request body', async () => {
    apiRequest.mockResolvedValue(
      new Response(
        JSON.stringify({
          checkout_attempt_id: 'attempt-1',
          status: 'pending',
          checkout_url: 'http://sandbox.test/checkout',
          provider: 'fake',
          provider_checkout_ref: 'fake_checkout_1',
          amount_egp: 299,
          currency: 'EGP',
          expires_at: new Date().toISOString(),
          sandbox: true,
        }),
        { status: 201 },
      ),
    )

    await createBillingCheckout('growth_monthly_v1', 'one_time_card', 'checkout-key-123456')

    expect(apiRequest).toHaveBeenCalledWith('/billing/checkouts', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'checkout-key-123456' },
      body: {
        price_code: 'growth_monthly_v1',
        payment_mode: 'one_time_card',
        idempotency_key: 'checkout-key-123456',
      },
    })
  })

  it('surfaces stable API errors for owner actions', async () => {
    apiRequest.mockResolvedValue(
      new Response(JSON.stringify({ code: 'BILLING_SUBSCRIPTION_NOT_ACTIVE', message: 'No access' }), {
        status: 409,
        statusText: 'Conflict',
      }),
    )

    await expect(cancelBillingSubscription()).rejects.toMatchObject({
      status: 409,
      code: 'BILLING_SUBSCRIPTION_NOT_ACTIVE',
      message: 'No access',
    })
  })
})
