import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { LoginForm } from '../login-form'
import { useSession } from '../session-provider'
import { useSearchParams } from 'next/navigation'

const authMessages: Record<string, string> = {
  loginTitle: 'Sign in to your account',
  loginEmailLabel: 'Email address',
  loginEmailPlaceholder: 'you@example.com',
  loginPasswordLabel: 'Password',
  loginPasswordPlaceholder: '••••••••',
  loginSubmit: 'Sign in',
  registerSuccess: 'Account created. Please sign in.',
  validationEmailRequired: 'Email address is required',
  validationPasswordRequired: 'Password is required',
  errorInvalidCredentials: 'Incorrect email or password',
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
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('renders email and password fields', () => {
    render(<LoginForm />)

    expect(screen.getByLabelText(/email/i)).toBeDefined()
    expect(screen.getByLabelText(/password/i)).toBeDefined()
    expect(screen.getByRole('button', { name: /sign in/i })).toBeDefined()
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

  it('shows a success message after registration', () => {
    mockedUseSearchParams.mockReturnValue(
      new URLSearchParams({
        email: 'ahmed@example.com',
        registered: 'true',
      }) as unknown as ReturnType<typeof useSearchParams>,
    )

    render(<LoginForm />)

    expect(screen.getByText(/account created/i)).toBeDefined()
  })

  it('shows validation errors for empty fields', async () => {
    render(<LoginForm />)

    fireEvent.click(screen.getByRole('button', { name: /sign in/i }))

    await waitFor(() => {
      expect(screen.getByText(/email address is required/i)).toBeDefined()
    })
    expect(screen.getByText(/password is required/i)).toBeDefined()
  })

  it('calls session login with trimmed credentials', async () => {
    login.mockResolvedValue(undefined)

    render(<LoginForm />)

    typeInto(screen.getByLabelText(/email/i), '  ahmed@example.com  ')
    typeInto(screen.getByLabelText(/password/i), 'password123')
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }))

    await waitFor(() => {
      expect(login).toHaveBeenCalledWith({
        email: 'ahmed@example.com',
        password: 'password123',
      })
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
    typeInto(screen.getByLabelText(/password/i), 'password123')
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }))

    await waitFor(() => {
      expect(screen.getByText(/incorrect email or password/i)).toBeDefined()
    })
  })
})
