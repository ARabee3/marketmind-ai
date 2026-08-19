'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import type { BillingWalletResponse } from '@marketmind/contracts'
import { getBillingWallet } from '@/lib/api/billing'
import { useSession } from '@/features/auth/session-provider'

export type WalletContextValue = {
  readonly wallet: BillingWalletResponse | null
  readonly loading: boolean
  readonly error: boolean
  readonly refresh: () => Promise<void>
}

const WalletContext = createContext<WalletContextValue | null>(null)

export function WalletProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useSession()
  const [wallet, setWallet] = useState<BillingWalletResponse | null>(null)
  const [error, setError] = useState(false)

  const refresh = useCallback(async () => {
    setError(false)
    try {
      setWallet(await getBillingWallet())
    } catch {
      setError(true)
    }
  }, [])

  useEffect(() => {
    if (!isAuthenticated) return
    let active = true
    void getBillingWallet()
      .then((data) => {
        if (active) {
          setWallet(data)
          setError(false)
        }
      })
      .catch(() => {
        if (active) setError(true)
      })
    return () => {
      active = false
    }
  }, [isAuthenticated])

  const loading = isAuthenticated && wallet === null && !error

  const value: WalletContextValue = {
    wallet: isAuthenticated ? wallet : null,
    loading,
    error,
    refresh,
  }

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
}

export function useWallet(): WalletContextValue {
  const context = useContext(WalletContext)
  if (context === null) {
    throw new Error('useWallet must be used within a WalletProvider')
  }
  return context
}
