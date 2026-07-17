import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import {
  DashboardOnboarding,
  dashboardOnboardingStorageKey,
} from '../dashboard-onboarding'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, string | number>) => {
    if (key === 'eyebrow') return `eyebrow:${values?.current}/${values?.total}`
    return key
  },
}))

describe('DashboardOnboarding', () => {
  afterEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('opens on first visit for the current user', async () => {
    render(<DashboardOnboarding userId="owner-id" />)

    expect(await screen.findByRole('dialog')).not.toBeNull()
    expect(screen.getByRole('heading', { name: 'steps.control.title' })).not.toBeNull()
    expect(document.activeElement).toBe(screen.getAllByRole('button', { name: 'skip' })[0])
  })

  it('skips and persists dismissal for the current user', async () => {
    render(<DashboardOnboarding userId="owner-id" />)

    await screen.findByRole('dialog')
    fireEvent.click(screen.getAllByRole('button', { name: 'skip' })[0])

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
    expect(localStorage.getItem(dashboardOnboardingStorageKey('owner-id'))).toBe('dismissed')
  })

  it('walks through the steps and completes with Start', async () => {
    render(<DashboardOnboarding userId="owner-id" />)

    await screen.findByRole('dialog')
    fireEvent.click(screen.getByRole('button', { name: 'next' }))
    expect(screen.getByRole('heading', { name: 'steps.profile.title' })).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'next' }))
    expect(screen.getByRole('heading', { name: 'steps.evidence.title' })).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'next' }))
    expect(screen.getByRole('heading', { name: 'steps.confirm.title' })).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'start' }))

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
    expect(localStorage.getItem(dashboardOnboardingStorageKey('owner-id'))).toBe('dismissed')
  })

  it('does not open automatically after this user dismissed it', () => {
    localStorage.setItem(dashboardOnboardingStorageKey('owner-id'), 'dismissed')

    render(<DashboardOnboarding userId="owner-id" />)

    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('uses a user-scoped storage key', () => {
    expect(dashboardOnboardingStorageKey('first-user')).not.toBe(
      dashboardOnboardingStorageKey('second-user'),
    )
  })

  it('replays from the dashboard help button after dismissal', async () => {
    localStorage.setItem(dashboardOnboardingStorageKey('owner-id'), 'dismissed')

    render(<DashboardOnboarding userId="owner-id" />)

    fireEvent.click(screen.getByRole('button', { name: 'replay' }))

    expect(await screen.findByRole('dialog')).not.toBeNull()
    expect(screen.getByRole('heading', { name: 'steps.control.title' })).not.toBeNull()
  })

  it('stays usable when localStorage throws', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })

    render(<DashboardOnboarding userId="owner-id" />)

    expect(await screen.findByRole('dialog')).not.toBeNull()
    fireEvent.click(screen.getAllByRole('button', { name: 'skip' })[0])

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
  })

  it('keeps keyboard tab focus inside the dialog', async () => {
    render(<DashboardOnboarding userId="owner-id" />)

    const dialog = await screen.findByRole('dialog')
    const skip = screen.getAllByRole('button', { name: 'skip' })[0]
    const next = screen.getByRole('button', { name: 'next' })

    next.focus()
    fireEvent.keyDown(dialog, { key: 'Tab' })

    expect(document.activeElement).toBe(skip)
  })
})
