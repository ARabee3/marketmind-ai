import type {
  BillingCatalogResponse,
  BillingCheckoutResponse,
  BillingPaymentMode,
  BillingSubscriptionResponse,
  BillingTransactionsResponse,
  BillingUsageResponse,
} from '@marketmind/contracts'
import { apiRequest, type ApiRequestOptions } from '@/lib/api/client'

export type BillingApiError = {
  readonly status: number
  readonly code: string
  readonly message: string
}

async function request<T>(path: string, init?: ApiRequestOptions): Promise<T> {
  const response = await apiRequest(path, init)
  if (!response.ok) {
    throw await parseError(response)
  }
  return response.json() as Promise<T>
}

async function parseError(response: Response): Promise<BillingApiError> {
  let code = 'api_error'
  let message = response.statusText
  try {
    const body = await response.json()
    code = body?.code ?? body?.error?.code ?? code
    message = body?.message ?? body?.error?.message ?? message
  } catch {
    // Keep the HTTP status text when the API has no JSON error envelope.
  }
  return { status: response.status, code, message }
}

export function getBillingPrices(): Promise<BillingCatalogResponse> {
  return request<BillingCatalogResponse>('/billing/prices')
}

export function getBillingSubscription(): Promise<BillingSubscriptionResponse> {
  return request<BillingSubscriptionResponse>('/billing/subscription')
}

export function getBillingUsage(): Promise<BillingUsageResponse> {
  return request<BillingUsageResponse>('/billing/usage')
}

export function getBillingTransactions(): Promise<BillingTransactionsResponse> {
  return request<BillingTransactionsResponse>('/billing/transactions')
}

export function createBillingCheckout(
  priceCode: string,
  paymentMode: BillingPaymentMode,
  idempotencyKey: string,
): Promise<BillingCheckoutResponse> {
  return request<BillingCheckoutResponse>('/billing/checkouts', {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: {
      price_code: priceCode,
      payment_mode: paymentMode,
      idempotency_key: idempotencyKey,
    },
  })
}

export function confirmSandboxCheckout(
  providerCheckoutRef: string,
  outcome: 'paid' | 'failed' | 'pending',
): Promise<{ accepted: true; duplicate: boolean }> {
  return request('/billing/sandbox/confirm', {
    method: 'POST',
    body: {
      provider_checkout_ref: providerCheckoutRef,
      outcome,
    },
  })
}

export function cancelBillingSubscription(): Promise<BillingSubscriptionResponse> {
  return request<BillingSubscriptionResponse>('/billing/subscription/cancel', {
    method: 'POST',
    body: {},
  })
}

export function resumeBillingSubscription(): Promise<BillingSubscriptionResponse> {
  return request<BillingSubscriptionResponse>('/billing/subscription/resume', {
    method: 'POST',
    body: {},
  })
}
