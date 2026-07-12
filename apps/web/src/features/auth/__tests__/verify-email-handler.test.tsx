import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import type { ReactNode } from 'react'
import { VerifyEmailHandler } from '../verify-email-handler'
import { publicRequest } from '@/lib/api'
import { useSearchParams } from 'next/navigation'

const authMessages: Record<string, string> = {
  verifyEmailTitle: 'Verifying your email',
  verifyEmailVerifying: 'Verifying your email…',
  verifyEmailSuccessTitle: 'Email verified',
  verifyEmailSuccessBody: 'Your email is confirmed. You can now sign in.',
  verifyEmailSignIn: 'Go to sign in',
  verifyEmailExpiredTitle: 'This verification link has expired',
  verifyEmailExpiredBody:
    'Verification links are valid for 12 hours. You can request a new one below.',
  verifyEmailInvalidTitle: 'This verification link is no longer valid',
  verifyEmailInvalidBody:
    'The link may have been used already. You can request a new one below.',
  verifyEmailRateLimitedTitle: 'Too many verification attempts',
  verifyEmailRateLimitedBody:
    'Please wait a while before requesting a new link.',
  verifyEmailMissingTokenBody:
    'This verification link is incomplete. Please use the link from your email.',
  verifyEmailResendPrompt: "Didn't get the email or link expired?",
  verifyEmailResendAction: 'Resend verification email',
  resendVerificationTitle: 'Resend verification email',
  resendVerificationEmailLabel: 'Email address',
  resendVerificationEmailPlaceholder: 'you@example.com',
  resendVerificationSubmit: 'Resend link',
  resendVerificationSuccessTitle: 'Check your email',
  resendVerificationSuccessBody:
    'If an unverified account with that email exists, a new verification link is on its way.',
}

vi.mock('next-intl', () => ({
  useTranslations: (namespace: string) => {
    const messages = authMessages
    return (key: string) => messages[key] ?? key
  },
}))

vi.mock('@/lib/api', () => ({
  publicRequest: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useSearchParams: vi.fn(),
}))

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
  buttonVariants: () => '',
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    onClick,
    disabled,
  }: {
    children: ReactNode
    onClick?: () => void
    disabled?: boolean
  }) => (
    <button type="button" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
  buttonVariants: () => '',
}))

vi.mock('@/lib/utils', () => ({
  cn: (...classes: Array<string | undefined>) =>
    classes.filter(Boolean).join(' '),
}))

const mockPublicRequest = vi.mocked(publicRequest)
const mockedUseSearchParams = vi.mocked(useSearchParams)

function respondWith(status: number, body: unknown) {
  mockPublicRequest.mockResolvedValueOnce(
    new Response(JSON.stringify(body), { status }),
  )
}

function setToken(token: string | null) {
  mockedUseSearchParams.mockReturnValue(
    new URLSearchParams(token ? { token } : {}) as unknown as ReturnType<
      typeof useSearchParams
    >,
  )
}

describe('VerifyEmailHandler', () => {
  beforeEach(() => {
    mockPublicRequest.mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('shows the verifying state on mount and POSTs the token', async () => {
    setToken('valid-token')
    respondWith(200, { message: 'ok' })

    render(<VerifyEmailHandler />)

    expect(screen.getByText(/verifying your email/i)).toBeDefined()
    await waitFor(() => {
      expect(mockPublicRequest).toHaveBeenCalledWith('/auth/verify-email', {
        method: 'POST',
        body: { token: 'valid-token' },
      })
    })
  })

  it('shows the success state with a sign-in link on a 200 response', async () => {
    setToken('valid-token')
    respondWith(200, { message: 'ok' })

    render(<VerifyEmailHandler />)

    await waitFor(() => {
      expect(screen.getByText(/email verified/i)).toBeDefined()
    })
    expect(
      screen.getByRole('link', { name: /go to sign in/i }),
    ).toBeDefined()
  })

  it('switches to the expired state and exposes an inline resend trigger on ACTION_TOKEN_EXPIRED', async () => {
    setToken('expired-token')
    respondWith(422, { code: 'ACTION_TOKEN_EXPIRED' })

    render(<VerifyEmailHandler />)

    await waitFor(() => {
      expect(
        screen.getByText(/verification link has expired/i),
      ).toBeDefined()
    })
    expect(
      screen.getByText(/verification links are valid for 12 hours/i),
    ).toBeDefined()

    const trigger = screen.getByRole('button', {
      name: /resend verification email/i,
    })
    fireEvent.click(trigger)

    expect(
      screen.getByLabelText(/email address/i),
    ).toBeDefined()
  })

  it('switches to the invalid state on ACTION_TOKEN_CONSUMED', async () => {
    setToken('consumed-token')
    respondWith(422, { code: 'ACTION_TOKEN_CONSUMED' })

    render(<VerifyEmailHandler />)

    await waitFor(() => {
      expect(
        screen.getByText(/link may have been used already/i),
      ).toBeDefined()
    })
  })

  it('shows the rate-limited state on RATE_LIMIT_EXCEEDED', async () => {
    setToken('rate-token')
    respondWith(429, { code: 'RATE_LIMIT_EXCEEDED' })

    render(<VerifyEmailHandler />)

    await waitFor(() => {
      expect(screen.getByText(/too many verification attempts/i)).toBeDefined()
    })
  })

  it('shows the missing-token recovery path when no token is in the URL', () => {
    setToken(null)
    render(<VerifyEmailHandler />)

    expect(
      screen.getByText(/verification link is incomplete/i),
    ).toBeDefined()
    expect(mockPublicRequest).not.toHaveBeenCalled()
  })
})