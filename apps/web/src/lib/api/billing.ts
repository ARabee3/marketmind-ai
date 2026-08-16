import type {
  BillingBundlesResponse,
  BillingCheckoutResponse,
  BillingPaymentMode,
  BillingPointLedgerResponse,
  BillingTransactionsResponse,
  BillingWalletResponse,
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

export function getBillingBundles(): Promise<BillingBundlesResponse> {
  return request<BillingBundlesResponse>('/billing/bundles')
}

export function getBillingWallet(): Promise<BillingWalletResponse> {
  return request<BillingWalletResponse>('/billing/wallet')
}

export function getBillingLedger(): Promise<BillingPointLedgerResponse> {
  return request<BillingPointLedgerResponse>('/billing/wallet/ledger')
}

export function getBillingTransactions(): Promise<BillingTransactionsResponse> {
  return request<BillingTransactionsResponse>('/billing/transactions')
}

export function createBillingCheckout(
  bundleCode: string,
  paymentMode: BillingPaymentMode,
  idempotencyKey: string,
): Promise<BillingCheckoutResponse> {
  return request<BillingCheckoutResponse>('/billing/checkouts', {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: {
      bundle_code: bundleCode,
      payment_mode: paymentMode,
      idempotency_key: idempotencyKey,
    },
  })
}
