'use client'

import type { ReactNode } from 'react'
import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link, usePathname } from '@/i18n/navigation'
import { LanguageSwitcher } from '@/components/language-switcher'
import { useSession } from '@/features/auth/session-provider'
import { LogoutButton } from '@/features/auth/logout-button'
import { cn } from '@/lib/utils'
import {
  AppShellChevronIcon,
  AppShellNavIcon,
  type AppShellIconName,
} from './app-shell-icons'
import { AppShellMobileNav } from './app-shell-mobile-nav'

type NavItem = {
  href: '/discovery' | '/dashboard'
  labelKey: 'navDiscovery' | 'navDashboard'
  iconName: AppShellIconName
}

const NAV_ITEMS: NavItem[] = [
  { href: '/discovery', labelKey: 'navDiscovery', iconName: 'compass' },
  { href: '/dashboard', labelKey: 'navDashboard', iconName: 'layout-dashboard' },
]

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`)
}

export function AppShell({ brandName, children }: { brandName: string; children: ReactNode }) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  return (
    <div className="relative min-h-dvh overflow-hidden bg-background text-foreground">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-[radial-gradient(circle_at_top,var(--color-soft-teal),transparent_62%)] opacity-80" />
      <div className="pointer-events-none absolute end-0 top-20 h-72 w-72 rounded-full bg-action/5 blur-3xl" />
      <AppShellMobileNav
        brandName={brandName}
        navItems={NAV_ITEMS}
        topActions={
          <>
            <LanguageSwitcher />
          </>
        }
        drawerActions={<AuthSection />}
      />
      <DesktopSidebar
        brandName={brandName}
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed((current) => !current)}
      />
      <div
        className={cn(
          'relative transition-[margin] duration-300 ease-out',
          sidebarCollapsed ? 'md:ms-[84px]' : 'md:ms-[260px]',
        )}
      >
        <DesktopTopBar />
        <main
          id="main-content"
          className="mx-auto w-full max-w-[1200px] px-4 pt-5 pb-8 md:px-6 md:pt-6 md:pb-10"
        >
          {children}
        </main>
      </div>
    </div>
  )
}

function DesktopTopBar() {
  const t = useTranslations('Common')

  return (
    <header className="sticky top-0 z-20 hidden border-b border-border/70 bg-background/85 px-6 py-3 backdrop-blur md:block">
      <div className="mx-auto flex max-w-[1200px] items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-semibold tracking-[0.14em] text-primary uppercase">
            {t('workspaceLabel')}
          </p>
          <p className="truncate text-sm text-muted-foreground">{t('tagline')}</p>
        </div>
        <div className="flex items-center gap-3">
          <LanguageSwitcher />
          <AuthSection />
        </div>
      </div>
    </header>
  )
}

function AuthSection() {
  const t = useTranslations('Auth')
  const { isAuthenticated } = useSession()

  if (isAuthenticated) {
    return <LogoutButton />
  }

  return (
    <div className="flex items-center gap-2">
      <Link
        href="/login"
        className="rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        {t('loginSubmit')}
      </Link>
      <Link
        href="/register"
        className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/80"
      >
        {t('registerSubmit')}
      </Link>
    </div>
  )
}

function DesktopSidebar({
  brandName,
  collapsed,
  onToggle,
}: {
  readonly brandName: string
  readonly collapsed: boolean
  readonly onToggle: () => void
}) {
  const t = useTranslations('Common')
  const pathname = usePathname()

  return (
    <aside
      className={cn(
        'fixed inset-y-0 start-0 z-30 hidden flex-col border-e border-border/80 bg-surface/95 shadow-header backdrop-blur transition-[width] duration-300 ease-out md:flex',
        collapsed ? 'w-[84px]' : 'w-[260px]',
      )}
    >
      <div
        className={cn(
          'relative flex min-h-20 items-center gap-3 px-4',
          collapsed && 'flex-col justify-center pt-5 pb-3',
        )}
      >
        <Link
          href="/dashboard"
          className={cn(
            'flex min-w-0 flex-1 items-center gap-3 rounded-lg text-navy outline-none transition-colors hover:text-primary focus-visible:ring-3 focus-visible:ring-ring/40',
            collapsed && 'flex-none justify-center',
          )}
          aria-label={brandName}
        >
          <span className="grid size-11 shrink-0 place-items-center rounded-lg border-2 border-navy bg-primary text-base font-bold text-primary-foreground shadow-tactile">
            M
          </span>
          <span className={cn('min-w-0', collapsed && 'sr-only')}>
            <span className="block truncate text-lg font-bold">{brandName}</span>
            <span className="block truncate text-xs text-muted-foreground">{t('tagline')}</span>
          </span>
        </Link>
        <button
          type="button"
          aria-label={collapsed ? t('expandSidebar') : t('collapseSidebar')}
          aria-expanded={!collapsed}
          onClick={onToggle}
          className={cn(
            'hidden size-9 shrink-0 place-items-center rounded-lg border border-border bg-background text-navy shadow-sm transition hover:border-primary hover:text-primary focus-visible:ring-3 focus-visible:ring-ring/40 md:grid',
            collapsed && 'absolute top-5 -end-4 bg-surface',
          )}
        >
          <AppShellChevronIcon collapsed={collapsed} />
        </button>
      </div>
      <nav
        aria-label={t('primaryNavLabel')}
        className="flex flex-1 flex-col gap-1 px-4 pt-3"
      >
        <ul className="flex flex-col gap-1">
          {NAV_ITEMS.map((item) => {
            const active = isActive(pathname, item.href)
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  title={collapsed ? t(item.labelKey) : undefined}
                  className={cn(
                    'flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-semibold transition-all focus-visible:ring-3 focus-visible:ring-ring/40',
                    collapsed && 'justify-center',
                    active
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'text-muted-foreground hover:bg-soft-teal hover:text-primary',
                  )}
                >
                  <AppShellNavIcon name={item.iconName} />
                  <span className={cn(collapsed && 'sr-only')}>{t(item.labelKey)}</span>
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>
      <div className="px-4 py-4">
        <div
          className={cn(
            'rounded-lg border border-border bg-background p-3',
            collapsed && 'grid place-items-center p-2',
          )}
        >
          <span className="inline-flex size-9 items-center justify-center rounded-full bg-soft-teal text-sm font-bold text-primary">
            MM
          </span>
          <p className={cn('mt-2 text-xs leading-5 text-muted-foreground', collapsed && 'sr-only')}>
            {t('ownerControlHint')}
          </p>
        </div>
      </div>
    </aside>
  )
}
