import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent, waitFor } from '@testing-library/react'
import { screen } from '@testing-library/dom'
import { LogoutButton } from '../logout-button'

const logout = vi.fn()
const replace = vi.fn()

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ replace }),
}))

vi.mock('../session-provider', () => ({
  useSession: () => ({ logout }),
}))

describe('LogoutButton', () => {
  it('renders a sign-out button', () => {
    render(<LogoutButton />)
    expect(screen.getByRole('button', { name: 'logout' })).toBeTruthy()
  })

  it('calls logout and redirects to login on click', async () => {
    logout.mockResolvedValueOnce(undefined)
    render(<LogoutButton />)

    fireEvent.click(screen.getByRole('button', { name: 'logout' }))

    await waitFor(() => {
      expect(logout).toHaveBeenCalledTimes(1)
      expect(replace).toHaveBeenCalledWith('/login')
    })
  })
})
