import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import { WalletProvider, useWallet } from '../wallet-context'
import type { BillingWalletResponse } from '@marketmind/contracts'

let isAuthenticated = false

vi.mock('@/features/auth/session-provider', () => ({
  useSession: () => ({ isAuthenticated }),
}))

const getBillingWalletMock = vi.fn()

vi.mock('@/lib/api/billing', () => ({
  getBillingWallet: () => getBillingWalletMock(),
}))

const walletFixture: BillingWalletResponse = {
  billing_account_id: 'acc-1',
  balance: 215,
  lifetime_granted: 365,
  lifetime_spent: 150,
  low_balance: false,
}

function TestConsumer() {
  const { wallet, loading, error, refresh } = useWallet()
  return (
    <div>
      <span data-testid="balance">{wallet?.balance ?? 'none'}</span>
      <span data-testid="loading">{loading ? 'loading' : 'idle'}</span>
      <span data-testid="error">{error ? 'error' : 'ok'}</span>
      <button data-testid="refresh" onClick={() => void refresh()}>
        Refresh
      </button>
    </div>
  )
}

describe('WalletProvider', () => {
  beforeEach(() => {
    isAuthenticated = false
    getBillingWalletMock.mockReset()
  })

  it('fetches the wallet once authenticated', async () => {
    isAuthenticated = true
    getBillingWalletMock.mockResolvedValue(walletFixture)

    render(
      <WalletProvider>
        <TestConsumer />
      </WalletProvider>,
    )

    const balance = await screen.findByTestId('balance')
    expect(balance.textContent).toBe('215')
    expect(getBillingWalletMock).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('error').textContent).toBe('ok')
  })

  it('keeps the wallet null when unauthenticated', async () => {
    render(
      <WalletProvider>
        <TestConsumer />
      </WalletProvider>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('idle')
    })
    expect(screen.getByTestId('balance').textContent).toBe('none')
    expect(getBillingWalletMock).not.toHaveBeenCalled()
  })

  it('marks error state when the fetch fails', async () => {
    isAuthenticated = true
    getBillingWalletMock.mockRejectedValue(new Error('network down'))

    render(
      <WalletProvider>
        <TestConsumer />
      </WalletProvider>,
    )

    const error = await screen.findByTestId('error')
    expect(error.textContent).toBe('error')
    expect(screen.getByTestId('balance').textContent).toBe('none')
  })

  it('refreshes on demand', async () => {
    isAuthenticated = true
    getBillingWalletMock.mockResolvedValue(walletFixture)

    render(
      <WalletProvider>
        <TestConsumer />
      </WalletProvider>,
    )

    await screen.findByTestId('balance')
    await act(async () => {
      screen.getByTestId('refresh').click()
    })
    expect(getBillingWalletMock).toHaveBeenCalledTimes(2)
  })
})
