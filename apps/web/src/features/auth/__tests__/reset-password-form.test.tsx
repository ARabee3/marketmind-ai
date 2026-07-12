import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import type { ReactNode } from 'react'
import { ResetPasswordForm } from '../reset-password-form'
import { publicRequest } from '@/lib/api'
import { useRouter } from '@/i18n/navigation'
import { useSearchParams } from 'next/navigation'

const authMessages: Record<string, string> = {
  resetPasswordTitle: 'Set a new password',
  resetPasswordPasswordLabel: 'New password',
  resetPasswordPasswordPlaceholder: '••••••••',
  resetPasswordConfirmPasswordLabel: 'Confirm new password',
  resetPasswordConfirmPasswordPlaceholder: '••••••••',
  resetPasswordSubmit: 'Reset password',
  resetPasswordSuccessTitle: 'Password reset',
  resetPasswordSuccessBody:
    'Your password has been reset. You can sign in with your new password.',
  resetPasswordSignIn: 'Go to sign in',
  resetPasswordMissingTokenTitle: 'Invalid reset link',
  resetPasswordMissingTokenBody:
    'This reset link is incomplete. Please request a new reset link.',
  resetPasswordRequestNew: 'Request a new link',
  resetPasswordExpiredTitle: 'This reset link has expired',
  resetPasswordExpiredBody:
    'Reset links are valid for 30 minutes. Please request a new one.',
  resetPasswordInvalidTitle: 'This reset link is no longer valid',
  resetPasswordInvalidBody:
    'The link may have been used already. Please request a new one if you still need it.',
  validationPasswordRequired: 'Password is required',
  validationPasswordMinLength:
    'Password must be at least {min} characters',
  validationConfirmPasswordRequired: 'Please confirm your password',
  validationConfirmPasswordMismatch: 'Passwords do not match',
  errorTokenExpired: 'This link has expired.',
  errorTokenInvalid: 'This link is no longer valid.',
  errorTokenConsumed: 'This link has already been used.',
  errorRateLimited: 'Too many attempts. Please wait and try again.',
  errorResetFailed: 'Could not reset your password. Please try again.',
}

const commonMessages: Record<string, string> = {
  loading: 'Loading...',
}

vi.mock('next-intl', () => ({
  useTranslations: (namespace: string) => {
    const messages = namespace === 'Auth' ? authMessages : commonMessages
    return (key: string, values?: Record<string, unknown>) => {
      let text = messages[key] ?? key
      if (values) {
        Object.entries(values).forEach(([k, v]) => {
          text = text.replace(`{${k}}`, String(v))
        })
      }
      return text
    }
  },
}))

vi.mock('@/lib/api', () => ({
  publicRequest: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useSearchParams: vi.fn(),
}))

vi.mock('@/i18n/navigation', () => ({
  useRouter: vi.fn(),
  Link: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}))

const mockedPublicRequest = vi.mocked(publicRequest)
const mockedUseRouter = vi.mocked(useRouter)
const mockedUseSearchParams = vi.mocked(useSearchParams)

function typeInto(element: HTMLElement, value: string) {
  fireEvent.change(element, { target: { value } })
}

function setSearchParams(params: URLSearchParams) {
  mockedUseSearchParams.mockReturnValue(
    params as unknown as ReturnType<typeof useSearchParams>,
  )
}

function fillAndSubmitPasswordForm() {
  typeInto(screen.getByLabelText(/^new password/i), 'password123')
  typeInto(screen.getByLabelText(/confirm new password/i), 'password123')
  fireEvent.click(screen.getByRole('button', { name: /reset password/i }))
}

describe('ResetPasswordForm', () => {
  const push = vi.fn()

  beforeEach(() => {
    mockedUseRouter.mockReturnValue({ push } as unknown as ReturnType<
      typeof useRouter
    >)
    mockedPublicRequest.mockReset()
    push.mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('shows the invalid-link recovery path when no token is present', () => {
    setSearchParams(new URLSearchParams())
    render(<ResetPasswordForm />)

    expect(screen.getByText(/reset link is incomplete/i)).toBeDefined()
    const link = screen.getByRole('link', { name: /request a new link/i })
    expect((link as HTMLAnchorElement).getAttribute('href')).toContain(
      '/forgot-password',
    )
  })

  it('submits the new password and shows the success state with a sign-in link', async () => {
    setSearchParams(new URLSearchParams({ token: 'valid-token' }))
    mockedPublicRequest.mockResolvedValue(
      new Response(JSON.stringify({ message: 'ok' }), { status: 200 }),
    )

    render(<ResetPasswordForm />)
    fillAndSubmitPasswordForm()

    await waitFor(() => {
      expect(mockedPublicRequest).toHaveBeenCalledWith('/auth/reset-password', {
        method: 'POST',
        body: { token: 'valid-token', newPassword: 'password123' },
      })
    })

    expect(screen.getByText(/your password has been reset/i)).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: /go to sign in/i }))
    await waitFor(() => {
      expect(push).toHaveBeenCalledWith('/login?reset=true')
    })
  })

  it('switches to the expired state on ACTION_TOKEN_EXPIRED', async () => {
    setSearchParams(new URLSearchParams({ token: 'expired-token' }))
    mockedPublicRequest.mockResolvedValue(
      new Response(JSON.stringify({ code: 'ACTION_TOKEN_EXPIRED' }), {
        status: 422,
      }),
    )

    render(<ResetPasswordForm />)
    fillAndSubmitPasswordForm()

    await waitFor(() => {
      expect(
        screen.getByRole('link', { name: /request a new link/i }),
      ).toBeDefined()
    })
  })

  it('switches to the invalid state on ACTION_TOKEN_CONSUMED', async () => {
    setSearchParams(new URLSearchParams({ token: 'consumed-token' }))
    mockedPublicRequest.mockResolvedValue(
      new Response(JSON.stringify({ code: 'ACTION_TOKEN_CONSUMED' }), {
        status: 422,
      }),
    )

    render(<ResetPasswordForm />)
    fillAndSubmitPasswordForm()

    await waitFor(() => {
      expect(
        screen.getByText(/link may have been used already/i),
      ).toBeDefined()
    })
  })

  it('shows a password-mismatch validation error', async () => {
    setSearchParams(new URLSearchParams({ token: 'valid-token' }))
    render(<ResetPasswordForm />)

    typeInto(screen.getByLabelText(/^new password/i), 'password123')
    typeInto(screen.getByLabelText(/confirm new password/i), 'different123')
    fireEvent.click(screen.getByRole('button', { name: /reset password/i }))

    await waitFor(() => {
      expect(screen.getByText(/passwords do not match/i)).toBeDefined()
    })
    expect(mockedPublicRequest).not.toHaveBeenCalled()
  })
})