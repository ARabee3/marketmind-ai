import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render } from '@testing-library/react'
import { screen } from '@testing-library/dom'
import { AppShell } from '../layout/app-shell'

const t = (key: string) => {
  const dict: Record<string, string> = {
    appName: 'MarketMind AI',
    navHome: 'Home',
    navDiscovery: 'Discovery',
    navDashboard: 'Dashboard',
    primaryNavLabel: 'Primary',
    mobileNavLabel: 'Mobile primary',
    workspaceLabel: 'Workspace',
    tagline: 'Marketing intelligence for SMEs',
    collapseSidebar: 'Collapse sidebar',
    expandSidebar: 'Expand sidebar',
    openNavigation: 'Open navigation',
    closeNavigation: 'Close navigation',
    ownerControlHint: 'Every important step waits for a clear owner decision.',
    loginSubmit: 'Sign in',
    registerSubmit: 'Create account',
    logout: 'Sign out',
  }
  return dict[key] ?? key
}

vi.mock('next-intl', () => ({
  useTranslations: () => t,
  useLocale: () => 'en',
}))

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  ),
  usePathname: () => '/dashboard',
  useRouter: () => ({ replace: vi.fn() }),
}))

vi.mock('@/components/language-switcher', () => ({
  LanguageSwitcher: () => <button type="button" aria-label="Language: Arabic">AR</button>,
}))

let authenticated = false

vi.mock('@/features/auth/session-provider', () => ({
  useSession: () => ({ isAuthenticated: authenticated }),
}))

vi.mock('@/features/auth/logout-button', () => ({
  LogoutButton: ({ size }: { size?: string }) => (
    <button type="button" data-size={size}>Sign out</button>
  ),
}))

describe('AppShell', () => {
  it('renders brand in both mobile top bar and desktop sidebar', () => {
    render(
      <AppShell brandName="MarketMind AI">
        <div>content</div>
      </AppShell>,
    )
    const brands = screen.getAllByText('MarketMind AI')
    expect(brands).toHaveLength(2)
  })

  it('renders primary desktop sidebar and mobile drawer with all destinations', () => {
    render(
      <AppShell brandName="MarketMind AI">
        <div>content</div>
      </AppShell>,
    )

    const primaryNavs = screen.getAllByLabelText('Primary')
    expect(primaryNavs).toHaveLength(1)
    expect(primaryNavs[0].closest('aside')?.className).toMatch(/(^|\s)hidden(\s|$)/)
    expect(primaryNavs[0].closest('aside')?.className).toMatch(/md:flex/)

    expect(screen.queryByLabelText('Mobile primary')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }))
    expect(screen.getByLabelText('Mobile primary')).toBeTruthy()

    expect(screen.queryByRole('link', { name: 'Home' })).toBeNull()
    expect(screen.getAllByRole('link', { name: 'Discovery' })).toHaveLength(2)
    expect(screen.getAllByRole('link', { name: 'Dashboard' })).toHaveLength(2)
  })

  it('marks the dashboard link as current in both navs', () => {
    render(
      <AppShell brandName="MarketMind AI">
        <div>content</div>
      </AppShell>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }))
    const dashboardLinks = screen.getAllByRole('link', { name: 'Dashboard' })
    for (const link of dashboardLinks) {
      expect(link.getAttribute('aria-current')).toBe('page')
    }
  })

  it('keeps content inside a max-width 1200 container', () => {
    const { container } = render(
      <AppShell brandName="MarketMind AI">
        <p data-testid="copy">body</p>
      </AppShell>,
    )
    const main = container.querySelector('main#main-content')
    expect(main?.parentElement?.className).toMatch(/md:ms-\[260px\]/)
    expect(main?.className).toMatch(/max-w-\[1200px\]/)
    expect(main?.className).not.toMatch(/md:ms-\[260px\]/)
    expect(main?.textContent).toMatch(/body/)
  })

  it('renders login and register actions in the desktop top bar when unauthenticated', () => {
    authenticated = false
    const { container } = render(
      <AppShell brandName="MarketMind AI">
        <div>content</div>
      </AppShell>,
    )

    const desktopTopBar = container.querySelector('header.hidden')!
    expect(desktopTopBar.textContent).toMatch(/Sign in/)
    expect(desktopTopBar.textContent).toMatch(/Create account/)
  })

  it('renders logout action in the desktop top bar when authenticated', () => {
    authenticated = true
    const { container } = render(
      <AppShell brandName="MarketMind AI">
        <div>content</div>
      </AppShell>,
    )

    const desktopTopBar = container.querySelector('header.hidden')!
    expect(desktopTopBar.textContent).toMatch(/Sign out/)
  })

  it('renders auth actions inside the mobile drawer', () => {
    authenticated = false
    render(
      <AppShell brandName="MarketMind AI">
        <div>content</div>
      </AppShell>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }))
    const mobileNav = screen.getByLabelText('Mobile primary').closest('aside')!
    expect(mobileNav.textContent).toMatch(/Sign in/)
    expect(mobileNav.textContent).toMatch(/Create account/)
  })

  it('can collapse the desktop sidebar', () => {
    const { container } = render(
      <AppShell brandName="MarketMind AI">
        <div>content</div>
      </AppShell>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }))

    const main = container.querySelector('main#main-content')
    expect(main?.parentElement?.className).toMatch(/md:ms-\[84px\]/)
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeTruthy()
  })

  it('locks the drawer as a focus-trapped dialog and restores focus on close', () => {
    const { baseElement } = render(
      <AppShell brandName="MarketMind AI">
        <div>content</div>
      </AppShell>,
    )

    const trigger = screen.getByRole('button', { name: 'Open navigation' })
    trigger.focus()

    fireEvent.click(trigger)

    const dialog = screen.getByLabelText('Mobile primary').closest('[role="dialog"]')!
    expect(dialog).not.toBeNull()
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    const workspace = baseElement.querySelector<HTMLElement>('main#main-content')?.parentElement
    expect(workspace?.inert).toBe(true)

    // Escape closes the drawer and returns focus to the trigger.
    fireEvent.keyDown(document, { key: 'Escape' })

    expect(screen.queryByLabelText('Mobile primary')).toBeNull()
    expect(workspace?.inert).toBe(false)
    expect(baseElement.ownerDocument.activeElement).toBe(trigger)
  })
})
