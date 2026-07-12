import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import type { ReactNode } from 'react'
import { ForgotPasswordForm } from '../forgot-password-form'
import { publicRequest } from '@/lib/api'

const authMessages: Record<string, string> = {
  forgotPasswordTitle: 'Reset your password',
  forgotPasswordDescription:
    "Enter your email and we'll send a reset link if an account exists.",
  forgotPasswordEmailLabel: 'Email address',
  forgotPasswordEmailPlaceholder: 'you@example.com',
  forgotPasswordSubmit: 'Send reset link',
  forgotPasswordSuccessTitle: 'Check your email',
  forgotPasswordSuccessBody:
    'If an account with that email exists, a reset link is on its way.',
  forgotPasswordBackToLogin: 'Back to sign in',
  validationEmailRequired: 'Email address is required',
  validationEmailInvalid: 'Please enter a valid email address',
  errorRateLimited: 'Too many attempts. Please wait and try again.',
  errorRecoveryFailed: 'Something went wrong. Please try again.',
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

describe('ForgotPasswordForm', () => {
  beforeEach(() => {
    mockedPublicRequest.mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('renders the email field and submit button', () => {
    render(<ForgotPasswordForm />)
    expect(screen.getByLabelText(/email address/i)).toBeDefined()
    expect(
      screen.getByRole('button', { name: /send reset link/i }),
    ).toBeDefined()
  })

  it('shows a validation error when the email is empty', async () => {
    render(<ForgotPasswordForm />)
    fireEvent.click(screen.getByRole('button', { name: /send reset link/i }))

    await waitFor(() => {
      expect(screen.getByText(/email address is required/i)).toBeDefined()
    })
  })

  it('submits the email and shows the generic success state', async () => {
    mockedPublicRequest.mockResolvedValue(
      new Response(JSON.stringify({ message: 'ok' }), { status: 200 }),
    )

    render(<ForgotPasswordForm />)
    typeInto(screen.getByLabelText(/email address/i), 'ahmed@example.com')
    fireEvent.click(screen.getByRole('button', { name: /send reset link/i }))

    await waitFor(() => {
      expect(mockedPublicRequest).toHaveBeenCalledWith('/auth/forgot-password', {
        method: 'POST',
        body: { email: 'ahmed@example.com' },
      })
    })

    expect(screen.getByText(/check your email/i)).toBeDefined()
    expect(
      screen.getByText(/reset link is on its way/i),
    ).toBeDefined()
    expect(
      screen.getByRole('link', { name: /back to sign in/i }),
    ).toBeDefined()
  })

  it('displays a rate-limit error from the backend', async () => {
    mockedPublicRequest.mockResolvedValue(
      new Response(JSON.stringify({ code: 'RATE_LIMIT_EXCEEDED' }), {
        status: 429,
      }),
    )

    render(<ForgotPasswordForm />)
    typeInto(screen.getByLabelText(/email address/i), 'ahmed@example.com')
    fireEvent.click(screen.getByRole('button', { name: /send reset link/i }))

    await waitFor(() => {
      expect(screen.getByText(/too many attempts/i)).toBeDefined()
    })
  })

  it('falls back to a generic error on an unknown failure', async () => {
    mockedPublicRequest.mockResolvedValue(
      new Response(JSON.stringify({ code: 'SERVER_ERROR' }), { status: 500 }),
    )

    render(<ForgotPasswordForm />)
    typeInto(screen.getByLabelText(/email address/i), 'ahmed@example.com')
    fireEvent.click(screen.getByRole('button', { name: /send reset link/i }))

    await waitFor(() => {
      expect(screen.getByText(/something went wrong/i)).toBeDefined()
    })
  })
})