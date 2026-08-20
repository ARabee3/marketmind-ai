import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { LoginForm } from '../login-form'
import { useSession } from '../session-provider'
import { useSearchParams } from 'next/navigation'

const { replaceMock } = vi.hoisted(() => ({ replaceMock: vi.fn() }))

const authMessages: Record<string, string> = {
  loginTitle: 'Sign in to your account',
  loginEmailLabel: 'Email address',
  loginEmailPlaceholder: 'you@example.com',
  loginPasswordLabel: 'Password',
  loginPasswordPlaceholder: '••••••••',
  loginSubmit: 'Sign in',
  showPassword: 'Show password',
  hidePassword: 'Hide password',
  registerSuccess: 'Account created. Please sign in.',
  loginRegisteredConfirmation:
    'Account created. We sent a verification link to your email.',
  loginResetConfirmation:
    'Your password has been reset. Please sign in with your new password.',
  loginResendVerification: 'Resend verification email',
  validationEmailRequired: 'Email address is required',
  validationPasswordRequired: 'Password is required',
  errorInvalidCredentials: 'Incorrect email or password',
  errorEmailNotVerified: 'Please verify your email before signing in.',
  errorAccountSuspended: 'Your account is suspended.',
  errorAccountDisabled: 'Your account is disabled. Contact support if you need help.',
  suspensionReason: 'Reason: {reason}',
  suspensionReasonUnavailable: 'No suspension reason was provided.',
  contactSupport: 'Email support',
  supportEmail: 'hello@marketmind.ai',
  errorLoginFailed: 'Could not sign in. Please try again.',
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

vi.mock('../session-provider', () => ({
  useSession: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useSearchParams: vi.fn(),
}))

vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ replace: replaceMock }),
  Link: ({
    href,
    children,
    ...rest
  }: {
    href: string
    children: React.ReactNode
  } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

const mockedUseSession = vi.mocked(useSession)
const mockedUseSearchParams = vi.mocked(useSearchParams)

function typeInto(element: HTMLElement, value: string) {
  fireEvent.change(element, { target: { value } })
}

describe('LoginForm', () => {
  const login = vi.fn()

  beforeEach(() => {
    mockedUseSession.mockReturnValue({ login } as unknown as ReturnType<
      typeof useSession
    >)
    mockedUseSearchParams.mockReturnValue(
      new URLSearchParams() as unknown as ReturnType<typeof useSearchParams>,
    )
    login.mockReset()
    replaceMock.mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('renders email and password fields', () => {
    render(<LoginForm />)

    expect(screen.getByLabelText(/email/i)).toBeDefined()
    expect(screen.getByLabelText(/^password$/i)).toBeDefined()
    expect(screen.getByRole('button', { name: /sign in/i })).toBeDefined()
  })

  it('toggles password visibility when the eye button is clicked', () => {
    render(<LoginForm />)
    const passwordInput = screen.getByLabelText(/^password$/i)
    const toggleButton = screen.getByRole('button', { name: /show password/i })

    expect(passwordInput.getAttribute('type')).toBe('password')
    fireEvent.click(toggleButton)
    expect(passwordInput.getAttribute('type')).toBe('text')
    expect(screen.getByRole('button', { name: /hide password/i })).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: /hide password/i }))
    expect(passwordInput.getAttribute('type')).toBe('password')
  })

  it('prefills email from the query string', () => {
    mockedUseSearchParams.mockReturnValue(
      new URLSearchParams({ email: 'ahmed@example.com' }) as unknown as ReturnType<
        typeof useSearchParams
      >,
    )

    render(<LoginForm />)

    expect((screen.getByLabelText(/email/i) as HTMLInputElement).value).toBe(
      'ahmed@example.com',
    )
  })

  it('shows a verification-confirmation banner after registration', () => {
    mockedUseSearchParams.mockReturnValue(
      new URLSearchParams({
        email: 'ahmed@example.com',
        registered: 'true',
      }) as unknown as ReturnType<typeof useSearchParams>,
    )

    render(<LoginForm />)

    expect(
      screen.getByText(/we sent a verification link to your email/i),
    ).toBeDefined()
  })

  it('shows a password-reset confirmation banner', () => {
    mockedUseSearchParams.mockReturnValue(
      new URLSearchParams({
        reset: 'true',
      }) as unknown as ReturnType<typeof useSearchParams>,
    )

    render(<LoginForm />)

    expect(
      screen.getByText(/your password has been reset/i),
    ).toBeDefined()
  })

  it('sets spellCheck=false on email input', () => {
    render(<LoginForm />)
    const emailInput = screen.getByLabelText(/email/i)
    expect(emailInput.getAttribute('spellcheck')).toBe('false')
    expect(emailInput.getAttribute('dir')).toBe('ltr')
  })

  it('shows validation errors with role="alert" and focuses the first invalid field on submit', async () => {
    render(<LoginForm />)

    const emailInput = screen.getByLabelText(/email/i)
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }))

    await waitFor(() => {
      expect(document.activeElement).toBe(emailInput)
    })
    const emailError = screen.getByText(/email address is required/i)
    expect(emailError.getAttribute('role')).toBe('alert')
    expect(screen.getByText(/password is required/i).getAttribute('role')).toBe('alert')
  })

  it('calls session login with trimmed credentials', async () => {
    login.mockResolvedValue({ roles: [] })

    render(<LoginForm />)

    typeInto(screen.getByLabelText(/email/i), '  ahmed@example.com  ')
    typeInto(screen.getByLabelText(/^password$/i), 'password123')
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }))

    await waitFor(() => {
      expect(login).toHaveBeenCalledWith({
        email: 'ahmed@example.com',
        password: 'password123',
      })
    })
  })

  it('returns to a safe workspace route after login', async () => {
    login.mockResolvedValue({ roles: [] })
    mockedUseSearchParams.mockReturnValue(
      new URLSearchParams({ from: '/en/billing?period=current' }) as unknown as ReturnType<
        typeof useSearchParams
      >,
    )

    render(<LoginForm />)
    typeInto(screen.getByLabelText(/email/i), 'ahmed@example.com')
    typeInto(screen.getByLabelText(/^password$/i), 'password123')
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }))

    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith('/billing?period=current')
    })
  })

  it('falls back to the dashboard for an unsafe post-login route', async () => {
    login.mockResolvedValue({ roles: [] })
    mockedUseSearchParams.mockReturnValue(
      new URLSearchParams({ from: 'https://example.com' }) as unknown as ReturnType<
        typeof useSearchParams
      >,
    )

    render(<LoginForm />)
    typeInto(screen.getByLabelText(/email/i), 'ahmed@example.com')
    typeInto(screen.getByLabelText(/^password$/i), 'password123')
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }))

    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith('/dashboard')
    })
  })

  it('takes admins to the admin console after a direct login', async () => {
    login.mockResolvedValue({ roles: ['ADMIN'] })

    render(<LoginForm />)
    typeInto(screen.getByLabelText(/email/i), 'admin@example.com')
    typeInto(screen.getByLabelText(/^password$/i), 'password123')
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }))

    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith('/admin')
    })
  })

  it('keeps admins on the admin console when a workspace route was requested', async () => {
    login.mockResolvedValue({ roles: ['ADMIN'] })
    mockedUseSearchParams.mockReturnValue(
      new URLSearchParams({ from: '/en/dashboard' }) as unknown as ReturnType<
        typeof useSearchParams
      >,
    )

    render(<LoginForm />)
    typeInto(screen.getByLabelText(/email/i), 'admin@example.com')
    typeInto(screen.getByLabelText(/^password$/i), 'password123')
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }))

    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith('/admin')
    })
  })

  it('never routes a non-admin to an admin route from the query string', async () => {
    login.mockResolvedValue({ roles: [] })
    mockedUseSearchParams.mockReturnValue(
      new URLSearchParams({ from: '/en/admin' }) as unknown as ReturnType<
        typeof useSearchParams
      >,
    )

    render(<LoginForm />)
    typeInto(screen.getByLabelText(/email/i), 'ahmed@example.com')
    typeInto(screen.getByLabelText(/^password$/i), 'password123')
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }))

    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith('/dashboard')
    })
  })

  it('displays an error when login fails', async () => {
    login.mockRejectedValue({
      response: new Response(JSON.stringify({ code: 'INVALID_CREDENTIALS' }), {
        status: 401,
      }),
    })

    render(<LoginForm />)

    typeInto(screen.getByLabelText(/email/i), 'ahmed@example.com')
    typeInto(screen.getByLabelText(/^password$/i), 'password123')
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }))

    await waitFor(() => {
      expect(screen.getByText(/incorrect email or password/i)).toBeDefined()
    })
  })

  it('shows a resend-verification link when login returns EMAIL_NOT_VERIFIED', async () => {
    login.mockRejectedValue({
      response: new Response(
        JSON.stringify({ code: 'EMAIL_NOT_VERIFIED' }),
        { status: 401 },
      ),
    })

    render(<LoginForm />)

    typeInto(screen.getByLabelText(/email/i), 'ahmed@example.com')
    typeInto(screen.getByLabelText(/^password$/i), 'password123')
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }))

    await waitFor(() => {
      expect(
        screen.getByText(/please verify your email before signing in/i),
      ).toBeDefined()
    })
    const resendLink = screen.getByRole('link', {
      name: /resend verification email/i,
    })
    expect((resendLink as HTMLAnchorElement).getAttribute('href')).toContain(
      '/resend-verification',
    )
  })

  it('shows the suspension reason and support link when login returns ACCOUNT_SUSPENDED', async () => {
    login.mockRejectedValue({
      response: new Response(
        JSON.stringify({
          code: 'ACCOUNT_SUSPENDED',
          reason: 'Policy violation',
        }),
        { status: 401 },
      ),
    })

    render(<LoginForm />)

    typeInto(screen.getByLabelText(/email/i), 'ahmed@example.com')
    typeInto(screen.getByLabelText(/^password$/i), 'password123')
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }))

    expect(await screen.findByText('Your account is suspended.')).toBeDefined()
    expect(screen.getByText('Reason: Policy violation')).toBeDefined()
    expect(
      screen.getByRole('link', { name: 'Email support' }).getAttribute('href'),
    ).toBe('mailto:hello@marketmind.ai')
  })

  it('shows a disabled-account message and support link when login returns ACCOUNT_DISABLED', async () => {
    login.mockRejectedValue({
      response: new Response(
        JSON.stringify({ code: 'ACCOUNT_DISABLED', reason: 'ignored' }),
        { status: 401 },
      ),
    })

    render(<LoginForm />)

    typeInto(screen.getByLabelText(/email/i), 'ahmed@example.com')
    typeInto(screen.getByLabelText(/^password$/i), 'password123')
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }))

    expect(
      await screen.findByText(
        /your account is disabled\. contact support if you need help/i,
      ),
    ).toBeDefined()
    expect(screen.queryByText(/reason: ignored/i)).toBeNull()
    expect(
      screen.getByRole('link', { name: 'Email support' }).getAttribute('href'),
    ).toBe('mailto:hello@marketmind.ai')
  })
})
