import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import type { ReactNode } from 'react'
import { RegisterForm } from '../register-form'
import { apiRequest } from '@/lib/api'
import { useRouter } from '@/i18n/navigation'

const authMessages: Record<string, string> = {
  registerTitle: 'Create your account',
  registerNameLabel: 'Full name',
  registerNamePlaceholder: 'Ahmed Hassan',
  registerEmailLabel: 'Email address',
  registerEmailPlaceholder: 'you@example.com',
  registerPasswordLabel: 'Password',
  registerPasswordPlaceholder: '••••••••',
  registerConfirmPasswordLabel: 'Confirm password',
  registerConfirmPasswordPlaceholder: '••••••••',
  registerSubmit: 'Create account',
  validationNameRequired: 'Full name is required',
  validationEmailRequired: 'Email address is required',
  validationPasswordRequired: 'Password is required',
  validationConfirmPasswordRequired: 'Please confirm your password',
  validationPasswordMinLength: 'Password must be at least {min} characters',
  validationConfirmPasswordMismatch: 'Passwords do not match',
  errorEmailExists: 'An account with this email already exists',
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
  apiRequest: vi.fn(),
}))

vi.mock('@/i18n/navigation', () => ({
  useRouter: vi.fn(),
  Link: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

const mockedApiRequest = vi.mocked(apiRequest)
const mockedUseRouter = vi.mocked(useRouter)

function typeInto(element: HTMLElement, value: string) {
  fireEvent.change(element, { target: { value } })
}

describe('RegisterForm', () => {
  const push = vi.fn()

  beforeEach(() => {
    mockedUseRouter.mockReturnValue({ push } as unknown as ReturnType<
      typeof useRouter
    >)
    mockedApiRequest.mockReset()
    push.mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('renders all register fields', () => {
    render(<RegisterForm />)

    expect(screen.getByLabelText(/full name/i)).toBeDefined()
    expect(screen.getByLabelText(/email/i)).toBeDefined()
    expect(screen.getByLabelText(/^password/i)).toBeDefined()
    expect(screen.getByLabelText(/confirm password/i)).toBeDefined()
    expect(screen.getByRole('button', { name: /create account/i })).toBeDefined()
  })

  it('shows validation errors for empty fields', async () => {
    render(<RegisterForm />)

    fireEvent.click(screen.getByRole('button', { name: /create account/i }))

    await waitFor(() => {
      expect(screen.getByText(/full name is required/i)).toBeDefined()
    })
    expect(screen.getByText(/email address is required/i)).toBeDefined()
    expect(screen.getByText(/password is required/i)).toBeDefined()
    expect(screen.getByText(/please confirm your password/i)).toBeDefined()
  })

  it('shows a mismatch error when passwords differ', async () => {
    render(<RegisterForm />)

    typeInto(screen.getByLabelText(/^password/i), 'password123')
    typeInto(screen.getByLabelText(/confirm password/i), 'different123')
    fireEvent.click(screen.getByRole('button', { name: /create account/i }))

    await waitFor(() => {
      expect(screen.getByText(/passwords do not match/i)).toBeDefined()
    })
  })

  it('submits the registration and redirects to login with email', async () => {
    mockedApiRequest.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 201 }),
    )

    render(<RegisterForm />)

    typeInto(screen.getByLabelText(/full name/i), 'Ahmed Hassan')
    typeInto(screen.getByLabelText(/email/i), 'ahmed@example.com')
    typeInto(screen.getByLabelText(/^password/i), 'password123')
    typeInto(screen.getByLabelText(/confirm password/i), 'password123')
    fireEvent.click(screen.getByRole('button', { name: /create account/i }))

    await waitFor(() => {
      expect(mockedApiRequest).toHaveBeenCalledWith('/auth/register', {
        method: 'POST',
        body: {
          fullName: 'Ahmed Hassan',
          email: 'ahmed@example.com',
          password: 'password123',
        },
      })
    })

    expect(push).toHaveBeenCalledWith(
      '/login?email=ahmed%40example.com&registered=true',
    )
  })

  it('displays a backend error when registration fails', async () => {
    mockedApiRequest.mockResolvedValue(
      new Response(JSON.stringify({ code: 'EMAIL_EXISTS' }), { status: 409 }),
    )

    render(<RegisterForm />)

    typeInto(screen.getByLabelText(/full name/i), 'Ahmed Hassan')
    typeInto(screen.getByLabelText(/email/i), 'ahmed@example.com')
    typeInto(screen.getByLabelText(/^password/i), 'password123')
    typeInto(screen.getByLabelText(/confirm password/i), 'password123')
    fireEvent.click(screen.getByRole('button', { name: /create account/i }))

    await waitFor(() => {
      expect(
        screen.getByText(/an account with this email already exists/i),
      ).toBeDefined()
    })
  })
})
