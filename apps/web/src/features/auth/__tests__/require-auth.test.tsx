import { describe, it, expect, vi } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { screen } from '@testing-library/dom'
import { RequireAuth } from '../require-auth'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

const replace = vi.fn()

vi.mock('@/i18n/navigation', () => ({
  redirect: vi.fn(),
  useRouter: () => ({ replace }),
  usePathname: () => '/en/dashboard',
}))

vi.mock('../session-provider', () => ({
  useSession: vi.fn(),
}))

const { useSession } = await import('../session-provider')

describe('RequireAuth', () => {
  it('renders children when authenticated', () => {
    ;(useSession as ReturnType<typeof vi.fn>).mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
    })

    render(
      <RequireAuth>
        <div data-testid="protected">private content</div>
      </RequireAuth>,
    )

    expect(screen.getByTestId('protected').textContent).toBe('private content')
  })

  it('renders loading state while session is loading', () => {
    ;(useSession as ReturnType<typeof vi.fn>).mockReturnValue({
      isAuthenticated: false,
      isLoading: true,
    })

    render(
      <RequireAuth>
        <div data-testid="protected">private content</div>
      </RequireAuth>,
    )

    expect(screen.getByText('loading')).toBeTruthy()
    expect(screen.queryByTestId('protected')).toBeNull()
  })

  it('redirects unauthenticated users to login when loading is complete', async () => {
    ;(useSession as ReturnType<typeof vi.fn>).mockReturnValue({
      isAuthenticated: false,
      isLoading: false,
    })

    render(
      <RequireAuth>
        <div data-testid="protected">private content</div>
      </RequireAuth>,
    )

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith('/login?from=%2Fen%2Fdashboard')
    })
  })
})
