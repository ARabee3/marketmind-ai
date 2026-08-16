import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createBillingCheckout, getBillingBundles } from '@/lib/api/billing'

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }))

vi.mock('@/lib/api/client', () => ({
  apiRequest,
}))

describe('billing API client', () => {
  beforeEach(() => {
    apiRequest.mockReset()
  })

  it('reads the server-controlled bundle catalog', async () => {
    apiRequest.mockResolvedValue(
      new Response(
        JSON.stringify({ version: 'billing-bundles-v1', currency: 'EGP', bundles: [] }),
        { status: 200 },
      ),
    )

    await expect(getBillingBundles()).resolves.toEqual({
      version: 'billing-bundles-v1',
      currency: 'EGP',
      bundles: [],
    })
    expect(apiRequest).toHaveBeenCalledWith('/billing/bundles', undefined)
  })

  it('sends the bundle code and the same idempotency key in header and body', async () => {
    apiRequest.mockResolvedValue(
      new Response(
        JSON.stringify({
          checkout_attempt_id: 'attempt-1',
          status: 'pending',
          checkout_url: 'http://sandbox.test/checkout',
          provider: 'fake',
          provider_checkout_ref: 'fake_checkout_1',
          amount_egp: 200,
          currency: 'EGP',
          expires_at: new Date().toISOString(),
          sandbox: true,
        }),
        { status: 201 },
      ),
    )

    await createBillingCheckout('growth_300', 'one_time_card', 'checkout-key-123456')

    expect(apiRequest).toHaveBeenCalledWith('/billing/checkouts', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'checkout-key-123456' },
      body: {
        bundle_code: 'growth_300',
        payment_mode: 'one_time_card',
        idempotency_key: 'checkout-key-123456',
      },
    })
  })

  it('surfaces stable API errors for owner actions', async () => {
    apiRequest.mockResolvedValue(
      new Response(JSON.stringify({ code: 'BILLING_BUNDLE_NOT_FOUND', message: 'Unknown bundle' }), {
        status: 404,
        statusText: 'Not Found',
      }),
    )

    await expect(
      createBillingCheckout('phantom_999', 'one_time_card', 'checkout-key-123456'),
    ).rejects.toMatchObject({
      status: 404,
      code: 'BILLING_BUNDLE_NOT_FOUND',
      message: 'Unknown bundle',
    })
  })
})
