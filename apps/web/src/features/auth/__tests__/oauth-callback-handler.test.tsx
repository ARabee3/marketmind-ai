import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as React from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { OAuthCallbackHandler } from '../oauth-callback-handler'
import { useSession } from '../session-provider'

const authMessages: Record<string, string> = {
  oauthCompletingSignIn: 'Completing sign in…',
  oauthRetryTitle: 'Could not complete sign in',
  oauthRetryDescription: 'Your session could not be restored. Please try again.',
  oauthRetryButton: 'Retry',
  oauthBackToSignIn: 'Back to sign in',
  continueWithGoogle: 'Continue with Google',
  oauthStateMismatchTitle: 'Sign-in request expired',
  oauthStateMismatchDescription: 'The sign-in link was no longer valid.',
  oauthProviderErrorTitle: 'Sign in could not finish',
  oauthProviderErrorDescription: 'Google sign in was cancelled or failed.',
  oauthEmailAlreadyUsedPasswordTitle: 'Account already uses password sign in',
  oauthEmailAlreadyUsedPasswordDescription:
    'This email is already registered with a password.',
  oauthFederatedIdentityConflictTitle:
    'Account linked to another sign-in method',
  oauthFederatedIdentityConflictDescription:
    'This account is already linked to a different sign-in method.',
  oauthRateLimitedTitle: 'Too many sign-in attempts',
  oauthRateLimitedDescription: 'Please wait a moment and try again.',
  oauthConfigurationErrorTitle: 'Sign in is temporarily unavailable',
  oauthConfigurationErrorDescription:
    'We are having trouble with Google sign in.',
  oauthUnknownErrorTitle: 'Sign in failed',
  oauthUnknownErrorDescription: 'Something went wrong.',
}

const commonMessages: Record<string, string> = {
  loading: 'Loading…',
}

vi.mock('next-intl', () => ({
  useTranslations: (namespace: string) => {
    const messages = namespace === 'Auth' ? authMessages : commonMessages
    return (key: string) => messages[key] ?? key
  },
}))

const replaceMock = vi.fn()

vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ replace: replaceMock }),
  Link: ({
    href,
    children,
    className,
  }: {
    href: string
    children: React.ReactNode
    className?: string
  }) => React.createElement('a', { href, className }, children),
}))

vi.mock('../session-provider', () => ({
  useSession: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useSearchParams: vi.fn(),
}))

import { useSearchParams } from 'next/navigation'

const mockedUseSession = vi.mocked(useSession)
const mockedUseSearchParams = vi.mocked(useSearchParams)

describe('OAuthCallbackHandler', () => {
  beforeEach(() => {
    replaceMock.mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('shows a loading state while SessionProvider is bootstrapping on success', () => {
    mockedUseSearchParams.mockReturnValue(
      new URLSearchParams({ status: 'success' }) as unknown as ReturnType<
        typeof useSearchParams
      >,
    )
    mockedUseSession.mockReturnValue({
      isLoading: true,
      isAuthenticated: false,
      refresh: vi.fn(),
    } as unknown as ReturnType<typeof useSession>)

    render(<OAuthCallbackHandler />)

    expect(screen.getByText(/completing sign in/i)).toBeDefined()
  })

  it('redirects to the dashboard after successful session restoration', async () => {
    mockedUseSearchParams.mockReturnValue(
      new URLSearchParams({ status: 'success' }) as unknown as ReturnType<
        typeof useSearchParams
      >,
    )
    mockedUseSession.mockReturnValue({
      isLoading: false,
      isAuthenticated: true,
      refresh: vi.fn(),
    } as unknown as ReturnType<typeof useSession>)

    render(<OAuthCallbackHandler />)

    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith('/dashboard')
    })
  })

  it('shows a retry action when session restoration finishes without authentication', () => {
    mockedUseSearchParams.mockReturnValue(
      new URLSearchParams({ status: 'success' }) as unknown as ReturnType<
        typeof useSearchParams
      >,
    )
    mockedUseSession.mockReturnValue({
      isLoading: false,
      isAuthenticated: false,
      refresh: vi.fn(),
    } as unknown as ReturnType<typeof useSession>)

    render(<OAuthCallbackHandler />)

    expect(screen.getByText(/could not complete sign in/i)).toBeDefined()
    expect(screen.getByRole('button', { name: /retry/i })).toBeDefined()
    expect(screen.getByRole('link', { name: /back to sign in/i })).toBeDefined()
  })

  it('calls refresh and redirects to dashboard when retry succeeds', async () => {
    mockedUseSearchParams.mockReturnValue(
      new URLSearchParams({ status: 'success' }) as unknown as ReturnType<
        typeof useSearchParams
      >,
    )
    const refresh = vi.fn().mockResolvedValue('refreshed-token')
    mockedUseSession.mockReturnValue({
      isLoading: false,
      isAuthenticated: false,
      refresh,
    } as unknown as ReturnType<typeof useSession>)

    render(<OAuthCallbackHandler />)

    fireEvent.click(screen.getByRole('button', { name: /retry/i }))

    await waitFor(() => {
      expect(refresh).toHaveBeenCalled()
    })
    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith('/dashboard')
    })
  })

  it('stays on the retry screen when refresh returns null', async () => {
    mockedUseSearchParams.mockReturnValue(
      new URLSearchParams({ status: 'success' }) as unknown as ReturnType<
        typeof useSearchParams
      >,
    )
    const refresh = vi.fn().mockResolvedValue(null)
    mockedUseSession.mockReturnValue({
      isLoading: false,
      isAuthenticated: false,
      refresh,
    } as unknown as ReturnType<typeof useSession>)

    render(<OAuthCallbackHandler />)

    fireEvent.click(screen.getByRole('button', { name: /retry/i }))

    await waitFor(() => {
      expect(refresh).toHaveBeenCalled()
    })

    expect(replaceMock).not.toHaveBeenCalled()
    expect(screen.getByText(/could not complete sign in/i)).toBeDefined()
  })

  it('does not start an automatic refresh while SessionProvider is loading', () => {
    const refresh = vi.fn().mockResolvedValue(null)
    mockedUseSearchParams.mockReturnValue(
      new URLSearchParams({ status: 'success' }) as unknown as ReturnType<
        typeof useSearchParams
      >,
    )
    mockedUseSession.mockReturnValue({
      isLoading: true,
      isAuthenticated: false,
      refresh,
    } as unknown as ReturnType<typeof useSession>)

    render(<OAuthCallbackHandler />)

    expect(refresh).not.toHaveBeenCalled()
  })

  it.each([
    ['OAUTH_STATE_MISMATCH', /sign-in request expired/i],
    ['OAUTH_PROVIDER_ERROR', /sign in could not finish/i],
    [
      'OAUTH_EMAIL_ALREADY_USED_PASSWORD',
      /account already uses password sign in/i,
    ],
    [
      'FEDERATED_IDENTITY_CONFLICT',
      /account linked to another sign-in method/i,
    ],
    ['AUTH_RATE_LIMITED', /too many sign-in attempts/i],
    ['OAUTH_CONFIGURATION_ERROR', /sign in is temporarily unavailable/i],
  ])(
    'renders the localized state for error code %s',
    (code, matcher) => {
      mockedUseSearchParams.mockReturnValue(
        new URLSearchParams({ error: code, message: 'sensitive detail' }) as unknown as ReturnType<
          typeof useSearchParams
        >,
      )
      mockedUseSession.mockReturnValue({
        isLoading: false,
        isAuthenticated: false,
        refresh: vi.fn(),
      } as unknown as ReturnType<typeof useSession>)

      render(<OAuthCallbackHandler />)

      expect(screen.getByText(matcher)).toBeDefined()
      expect(screen.queryByText('sensitive detail')).toBeNull()
    },
  )

  it('renders a safe unknown-error state for malformed callbacks', () => {
    mockedUseSearchParams.mockReturnValue(
      new URLSearchParams({ foo: 'bar' }) as unknown as ReturnType<
        typeof useSearchParams
      >,
    )
    mockedUseSession.mockReturnValue({
      isLoading: false,
      isAuthenticated: false,
      refresh: vi.fn(),
    } as unknown as ReturnType<typeof useSession>)

    render(<OAuthCallbackHandler />)

    expect(screen.getByText(/sign in failed/i)).toBeDefined()
    expect(screen.getByText(/something went wrong/i)).toBeDefined()
    expect(screen.getByRole('link', { name: /back to sign in/i })).toBeDefined()
  })

  it('never renders the URL-controlled message parameter', () => {
    mockedUseSearchParams.mockReturnValue(
      new URLSearchParams({
        error: 'OAUTH_PROVIDER_ERROR',
        message: 'malicious user-controlled message',
      }) as unknown as ReturnType<typeof useSearchParams>,
    )
    mockedUseSession.mockReturnValue({
      isLoading: false,
      isAuthenticated: false,
      refresh: vi.fn(),
    } as unknown as ReturnType<typeof useSession>)

    render(<OAuthCallbackHandler />)

    expect(screen.queryByText('malicious user-controlled message')).toBeNull()
  })
})
