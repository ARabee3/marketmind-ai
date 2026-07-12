import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import type { ReactNode } from 'react'
import { ResendVerificationForm } from '../resend-verification-form'
import { publicRequest } from '@/lib/api'

const authMessages: Record<string, string> = {
  resendVerificationTitle: 'Resend verification email',
  resendVerificationDescription:
    "Enter your email and we'll send a new verification link if your account is unverified.",
  resendVerificationEmailLabel: 'Email address',
  resendVerificationEmailPlaceholder: 'you@example.com',
  resendVerificationSubmit: 'Resend link',
  resendVerificationSuccessTitle: 'Check your email',
  resendVerificationSuccessBody:
    'If an unverified account with that email exists, a new verification link is on its way.',
  resendVerificationBackToLogin: 'Back to sign in',
  validationEmailRequired: 'Email address is required',
  validationEmailInvalid: 'Please enter a valid email address',
  errorRateLimited: 'Too many attempts. Please wait and try again.',
  errorResendFailed:
    'Could not resend the verification email. Please try again.',
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

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}))

const mockedPublicRequest = vi.mocked(publicRequest)

function typeInto(element: HTMLElement, value: string) {
  fireEvent.change(element, { target: { value } })
}

describe('ResendVerificationForm', () => {
  beforeEach(() => {
    mockedPublicRequest.mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('renders the email field and submit button in standalone mode', () => {
    render(<ResendVerificationForm />)
    expect(screen.getByLabelText(/email address/i)).toBeDefined()
    expect(screen.getByRole('button', { name: /resend link/i })).toBeDefined()
    expect(
      screen.getByRole('link', { name: /back to sign in/i }),
    ).toBeDefined()
  })

  it('hides the back-to-login link in inline mode', () => {
    render(<ResendVerificationForm mode="inline" />)
    expect(
      screen.queryByRole('link', { name: /back to sign in/i }),
    ).toBeNull()
  })

  it('submits the email and shows the generic success state', async () => {
    mockedPublicRequest.mockResolvedValue(
      new Response(JSON.stringify({ message: 'ok' }), { status: 200 }),
    )

    render(<ResendVerificationForm />)
    typeInto(screen.getByLabelText(/email address/i), 'ahmed@example.com')
    fireEvent.click(screen.getByRole('button', { name: /resend link/i }))

    await waitFor(() => {
      expect(mockedPublicRequest).toHaveBeenCalledWith(
        '/auth/resend-verification',
        {
          method: 'POST',
          body: { email: 'ahmed@example.com' },
        },
      )
    })

    expect(screen.getByText(/verification link is on its way/i)).toBeDefined()
  })

  it('displays a rate-limit error from the backend', async () => {
    mockedPublicRequest.mockResolvedValue(
      new Response(JSON.stringify({ code: 'RATE_LIMIT_EXCEEDED' }), {
        status: 429,
      }),
    )

    render(<ResendVerificationForm />)
    typeInto(screen.getByLabelText(/email address/i), 'ahmed@example.com')
    fireEvent.click(screen.getByRole('button', { name: /resend link/i }))

    await waitFor(() => {
      expect(screen.getByText(/too many attempts/i)).toBeDefined()
    })
  })

  it('calls onSuccess after a successful submit', async () => {
    mockedPublicRequest.mockResolvedValue(
      new Response(JSON.stringify({ message: 'ok' }), { status: 200 }),
    )
    const onSuccess = vi.fn()

    render(<ResendVerificationForm onSuccess={onSuccess} />)
    typeInto(screen.getByLabelText(/email address/i), 'ahmed@example.com')
    fireEvent.click(screen.getByRole('button', { name: /resend link/i }))

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalled()
    })
  })

  it('preserves a provided defaultEmail', () => {
    render(<ResendVerificationForm defaultEmail="prefilled@example.com" />)
    expect(
      (screen.getByLabelText(/email address/i) as HTMLInputElement).value,
    ).toBe('prefilled@example.com')
  })
})