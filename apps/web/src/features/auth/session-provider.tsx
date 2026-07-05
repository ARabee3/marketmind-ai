'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import {
  apiRequest,
  refreshAccessToken,
  setAccessToken,
  getAccessToken,
} from '@/lib/api'
import type { ApiError } from '@/lib/api'
import type { LoginCredentials, User } from './types'

export type SessionContextValue = {
  user: User | null
  accessToken: string | null
  isLoading: boolean
  isAuthenticated: boolean
  login: (credentials: LoginCredentials) => Promise<void>
  logout: () => Promise<void>
  refresh: () => Promise<string | null>
}

const SessionContext = createContext<SessionContextValue | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const syncToken = useCallback((token: string | null) => {
    setAccessToken(token)
  }, [])

  const fetchUser = useCallback(async (): Promise<User | null> => {
    const response = await apiRequest('/auth/me')
    if (!response.ok) return null
    const data = (await response.json()) as { user: User }
    return data.user ?? null
  }, [])

  const refresh = useCallback(async (): Promise<string | null> => {
    const token = await refreshAccessToken()
    if (!token) {
      syncToken(null)
      setUser(null)
      return null
    }
    const userData = await fetchUser()
    setUser(userData)
    return token
  }, [syncToken, fetchUser])

  const login = useCallback(
    async (credentials: LoginCredentials): Promise<void> => {
      const response = await apiRequest('/auth/login', {
        method: 'POST',
        body: credentials,
      })
      if (!response.ok) {
        const error = new Error('Login failed') as ApiError
        error.status = response.status
        error.response = response
        throw error
      }
      const data = (await response.json()) as { accessToken: string; user: User }
      syncToken(data.accessToken)
      setUser(data.user)
    },
    [syncToken],
  )

  const logout = useCallback(async (): Promise<void> => {
    await apiRequest('/auth/logout', { method: 'POST' })
    syncToken(null)
    setUser(null)
  }, [syncToken])

  // Initialise session on mount by calling the refresh endpoint. The HttpOnly
  // refresh cookie is sent automatically; a valid cookie restores the in-memory
  // access token and user profile. If refresh fails, the user is unauthenticated.
  useEffect(() => {
    let cancelled = false

    async function initSession() {
      try {
        const token = await refresh()
        if (cancelled) return

        if (token) {
          const userData = await fetchUser()
          if (!cancelled) setUser(userData)
        } else {
          setUser(null)
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    initSession()

    return () => {
      cancelled = true
    }
  }, [refresh, fetchUser])

  const accessToken = getAccessToken()

  const value: SessionContextValue = {
    user,
    accessToken,
    isLoading,
    isAuthenticated: user !== null && accessToken !== null,
    login,
    logout,
    refresh,
  }

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  )
}

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext)
  if (context === null) {
    throw new Error('useSession must be used within a SessionProvider')
  }
  return context
}
