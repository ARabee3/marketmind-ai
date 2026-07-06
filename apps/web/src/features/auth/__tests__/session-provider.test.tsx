import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import { SessionProvider, useSession } from '../session-provider'
import { setAccessToken } from '@/lib/api/token-store'
import * as realtime from '@/lib/realtime'

const fetchMock = vi.fn()

function getRequestPath(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.pathname
  return input.url
}

function TestConsumer() {
  const session = useSession()
  return (
    <div>
      <span data-testid="loading">{session.isLoading ? 'loading' : 'ready'}</span>
      <span data-testid="authenticated">
        {session.isAuthenticated ? 'yes' : 'no'}
      </span>
      <span data-testid="user">{session.user?.name ?? 'none'}</span>
      <span data-testid="token">{session.accessToken ?? 'none'}</span>
      <button
        data-testid="login"
        onClick={() =>
          session.login({ email: 'a@b.com', password: 'secret' })
        }
      >
        Login
      </button>
      <button data-testid="logout" onClick={() => session.logout()}>
        Logout
      </button>
    </div>
  )
}

describe('SessionProvider', () => {
  let resetSocketAuthSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    fetchMock.mockReset()
    resetSocketAuthSpy = vi.spyOn(realtime, 'resetSocketAuth')
    vi.stubGlobal('fetch', fetchMock)
    setAccessToken(null)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    resetSocketAuthSpy.mockRestore()
    setAccessToken(null)
  })

  it('bootstraps session by calling refresh on mount', async () => {
    fetchMock.mockImplementation((input) => {
      const path = getRequestPath(input)
      if (path === '/auth/refresh') {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              accessToken: 'refreshed-token',
              user: { id: '1', email: 'a@b.com', name: 'Ali' },
            }),
            { status: 200 },
          ),
        )
      }
      if (path === '/auth/me') {
        return Promise.resolve(
          new Response(
            JSON.stringify({ user: { id: '1', email: 'a@b.com', name: 'Ali' } }),
            { status: 200 },
          ),
        )
      }
      return Promise.resolve(new Response(null, { status: 500 }))
    })

    await act(async () => {
      render(
        <SessionProvider>
          <TestConsumer />
        </SessionProvider>,
      )
    })

    await waitFor(() =>
      expect(screen.getByTestId('loading').textContent).toBe('ready'),
    )

    expect(screen.getByTestId('authenticated').textContent).toBe('yes')
    expect(screen.getByTestId('user').textContent).toBe('Ali')
    expect(screen.getByTestId('token').textContent).toBe('refreshed-token')
  })

  it('remains unauthenticated when refresh fails', async () => {
    fetchMock.mockImplementation((input) => {
      const path = getRequestPath(input)
      if (path === '/auth/refresh') {
        return Promise.resolve(
          new Response(JSON.stringify({ error: 'Bad request' }), { status: 400 }),
        )
      }
      return Promise.resolve(new Response(null, { status: 500 }))
    })

    render(
      <SessionProvider>
        <TestConsumer />
      </SessionProvider>,
    )

    await waitFor(() =>
      expect(screen.getByTestId('loading').textContent).toBe('ready'),
    )

    expect(screen.getByTestId('authenticated').textContent).toBe('no')
    expect(screen.getByTestId('user').textContent).toBe('none')
    expect(resetSocketAuthSpy).toHaveBeenCalledTimes(1)
  })

  it('updates session on login', async () => {
    fetchMock.mockImplementation((input) => {
      const path = getRequestPath(input)
      if (path === '/auth/refresh') {
        return Promise.resolve(
          new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }),
        )
      }
      if (path === '/auth/login') {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              accessToken: 'login-token',
            }),
            { status: 200 },
          ),
        )
      }
      if (path === '/auth/me') {
        return Promise.resolve(
          new Response(
            JSON.stringify({ user: { id: '2', email: 'c@d.com', name: 'Omar' } }),
            { status: 200 },
          ),
        )
      }
      return Promise.resolve(new Response(null, { status: 500 }))
    })

    render(
      <SessionProvider>
        <TestConsumer />
      </SessionProvider>,
    )

    await waitFor(() =>
      expect(screen.getByTestId('loading').textContent).toBe('ready'),
    )
    expect(screen.getByTestId('authenticated').textContent).toBe('no')

    await act(async () => {
      screen.getByTestId('login').click()
    })

    await waitFor(() =>
      expect(screen.getByTestId('authenticated').textContent).toBe('yes'),
    )
    expect(screen.getByTestId('user').textContent).toBe('Omar')
    expect(screen.getByTestId('token').textContent).toBe('login-token')
  })

  it('clears session on logout', async () => {
    fetchMock.mockImplementation((input) => {
      const path = getRequestPath(input)
      if (path === '/auth/refresh') {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              accessToken: 'existing-token',
              user: { id: '3', email: 'd@e.com', name: 'Nour' },
            }),
            { status: 200 },
          ),
        )
      }
      if (path === '/auth/me') {
        return Promise.resolve(
          new Response(
            JSON.stringify({ user: { id: '3', email: 'd@e.com', name: 'Nour' } }),
            { status: 200 },
          ),
        )
      }
      if (path === '/auth/logout') {
        return Promise.resolve(new Response(null, { status: 204 }))
      }
      return Promise.resolve(new Response(null, { status: 500 }))
    })

    render(
      <SessionProvider>
        <TestConsumer />
      </SessionProvider>,
    )

    await waitFor(() =>
      expect(screen.getByTestId('loading').textContent).toBe('ready'),
    )
    expect(screen.getByTestId('authenticated').textContent).toBe('yes')

    await act(async () => {
      screen.getByTestId('logout').click()
    })

    await waitFor(() =>
      expect(screen.getByTestId('authenticated').textContent).toBe('no'),
    )
    expect(screen.getByTestId('user').textContent).toBe('none')
    expect(screen.getByTestId('token').textContent).toBe('none')
    expect(resetSocketAuthSpy).toHaveBeenCalledTimes(1)
  })

  it('throws when useSession is used outside the provider', () => {
    // Suppress console.error for the expected throw.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(() => render(<TestConsumer />)).toThrow(
      'useSession must be used within a SessionProvider',
    )

    spy.mockRestore()
  })
})
