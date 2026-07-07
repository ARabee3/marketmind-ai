'use client'

import type { ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { Link, usePathname } from '@/i18n/navigation'
import { LanguageSwitcher } from '@/components/language-switcher'

type NavItem = {
  href: '/' | '/discovery'
  labelKey: 'navHome' | 'navDiscovery'
  iconName: 'home' | 'compass'
}

const NAV_ITEMS: NavItem[] = [
  { href: '/', labelKey: 'navHome', iconName: 'home' },
  { href: '/discovery', labelKey: 'navDiscovery', iconName: 'compass' },
]

function isActive(pathname: string, href: string): boolean {
  if (href === '/') {
    return pathname === '/' || pathname === ''
  }
  return pathname === href || pathname.startsWith(`${href}/`)
}

function NavIcon({ name }: { name: NavItem['iconName'] }) {
  const common = {
    width: 20,
    height: 20,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  }
  if (name === 'compass') {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="10" />
        <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
      </svg>
    )
  }
  return (
    <svg {...common}>
      <path d="M3 9.5L12 3l9 6.5" />
      <path d="M5 9.5V21h14V9.5" />
      <path d="M9 21v-6h6v6" />
    </svg>
  )
}

export function AppShell({ brandName, children }: { brandName: string; children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <MobileTopBar brandName={brandName} />
      <DesktopSidebar brandName={brandName} />
      <MobileBottomNav />
      <div className="md:ms-[240px]">
        <main
          id="main-content"
          className="mx-auto w-full max-w-[1200px] px-4 pt-6 pb-24 md:pb-8"
        >
          {children}
        </main>
      </div>
    </div>
  )
}

function MobileTopBar({ brandName }: { brandName: string }) {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-surface px-4 md:hidden">
      <span className="text-lg font-semibold text-navy">{brandName}</span>
      <LanguageSwitcher />
    </header>
  )
}

function DesktopSidebar({ brandName }: { brandName: string }) {
  const t = useTranslations('Common')
  const pathname = usePathname()

  return (
    <aside className="fixed inset-y-0 start-0 z-30 hidden w-[240px] flex-col md:flex">
      <div className="flex h-16 items-center px-6 text-lg font-semibold text-navy">
        {brandName}
      </div>
      <nav
        aria-label={t('primaryNavLabel')}
        className="flex flex-1 flex-col gap-1 border-e border-border bg-surface px-4 pt-2"
      >
        <ul className="flex flex-col gap-1">
          {NAV_ITEMS.map((item) => {
            const active = isActive(pathname, item.href)
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                    active
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  }`}
                >
                  <NavIcon name={item.iconName} />
                  {t(item.labelKey)}
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>
      <div className="flex items-center justify-center border-e border-border bg-surface px-4 py-4">
        <LanguageSwitcher />
      </div>
    </aside>
  )
}

function MobileBottomNav() {
  const t = useTranslations('Common')
  const pathname = usePathname()

  return (
    <nav
      aria-label={t('mobileNavLabel')}
      className="fixed inset-x-0 bottom-0 z-30 flex h-16 items-stretch border-t border-border bg-surface md:hidden"
    >
      <ul className="flex w-full items-stretch">
        {NAV_ITEMS.map((item) => {
          const active = isActive(pathname, item.href)
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={`flex h-full w-full flex-col items-center justify-center gap-1 text-xs font-medium transition-colors ${
                  active
                    ? 'text-primary'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <NavIcon name={item.iconName} />
                {t(item.labelKey)}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
