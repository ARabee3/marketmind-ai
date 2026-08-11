"use client"

import type { ReactNode } from "react"
import { useTranslations } from "next-intl"
import { Link, usePathname } from "@/i18n/navigation"
import { LanguageSwitcher } from "@/components/language-switcher"
import { LogoutButton } from "@/features/auth/logout-button"
import { cn } from "@/lib/utils"
import {
  LayoutDashboard,
  Shield,
  Users,
  WalletCards,
  type LucideIcon,
} from "lucide-react"

type AdminNavItem = {
  href: string
  labelKey: "navOverview" | "navUsers" | "navRevenue"
  icon: LucideIcon
}

const ADMIN_NAV_ITEMS: AdminNavItem[] = [
  { href: "/admin", labelKey: "navOverview", icon: LayoutDashboard },
  { href: "/admin/users", labelKey: "navUsers", icon: Users },
  { href: "/admin/revenue", labelKey: "navRevenue", icon: WalletCards },
]

export function isAdminNavItemActive(pathname: string, href: string) {
  return href === "/admin"
    ? pathname === href
    : pathname === href || pathname.startsWith(`${href}/`)
}

export function AdminShell({
  brandName,
  children,
}: {
  brandName: string
  children: ReactNode
}) {
  const t = useTranslations("Admin")
  const tc = useTranslations("Common")
  const pathname = usePathname()

  return (
    <div className="relative min-h-dvh overflow-x-clip bg-background text-foreground">
      <a
        href="#main-content"
        className="fixed start-4 top-2 z-50 -translate-y-20 rounded-lg bg-navy px-3 py-2 text-sm font-semibold text-white transition-transform focus-visible:translate-y-0 focus-visible:ring-3 focus-visible:ring-action/50"
      >
        {tc("skipToMain")}
      </a>

      <div className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-[radial-gradient(circle_at_top,var(--color-soft-teal),transparent_62%)] opacity-80" />

      <aside className="fixed inset-y-0 start-0 z-30 hidden w-60 flex-col border-e border-border/80 bg-surface/95 shadow-header backdrop-blur lg:flex">
        <div className="flex min-h-20 items-center gap-3 px-4">
          <Link
            href="/admin"
            className="flex min-w-0 flex-1 items-center gap-3 rounded-lg text-navy outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/40"
            aria-label={brandName}
          >
            <span className="grid size-10 shrink-0 place-items-center rounded-lg border-2 border-navy bg-navy text-white">
              <Shield className="size-5" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-base font-bold tracking-tight">
                {brandName}
              </span>
              <span className="block truncate text-xs text-muted-foreground">
                {tc("tagline")}
              </span>
            </span>
          </Link>
        </div>

        <nav
          aria-label={t("adminNavLabel")}
          className="flex flex-1 flex-col gap-1 px-4 pt-3"
        >
          <div className="mb-3 px-3">
            <p className="text-[10px] font-bold tracking-[0.2em] text-navy/60 uppercase">
              {t("adminConsole")}
            </p>
          </div>
          <ul className="flex flex-col gap-1">
            {ADMIN_NAV_ITEMS.map((item) => {
              const active = isAdminNavItemActive(pathname, item.href)
              const Icon = item.icon
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "relative flex min-h-11 items-center gap-3 overflow-hidden rounded-lg px-3 text-sm font-semibold transition-[color,background-color,box-shadow] focus-visible:ring-3 focus-visible:ring-ring/40",
                      active
                        ? "bg-soft-teal text-primary shadow-sm ring-1 ring-primary/15"
                        : "text-muted-foreground hover:bg-muted hover:text-navy",
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        "absolute inset-y-2 start-0 w-1 rounded-e-full bg-primary transition-opacity",
                        active ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <Icon className="size-4 shrink-0" aria-hidden="true" />
                    {t(item.labelKey)}
                  </Link>
                </li>
              )
            })}
          </ul>
        </nav>

        <div className="px-4 py-4">
          <div className="flex items-center justify-between gap-2">
            <LanguageSwitcher />
            <LogoutButton />
          </div>
        </div>
      </aside>

      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-border/70 bg-background/85 px-4 py-3 backdrop-blur lg:hidden">
        <div className="flex items-center gap-3">
          <Shield className="size-5 text-navy" />
          <span className="text-sm font-bold text-navy">{brandName}</span>
        </div>
        <div className="flex items-center gap-2">
          <LanguageSwitcher />
          <LogoutButton />
        </div>
      </header>

      <nav
        aria-label={t("adminNavLabel")}
        className="fixed inset-x-0 bottom-0 z-30 flex justify-center gap-1 border-t border-border/80 bg-surface/95 px-2 pt-1 pb-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur lg:hidden"
      >
        {ADMIN_NAV_ITEMS.map((item) => {
          const active = isAdminNavItemActive(pathname, item.href)
          const Icon = item.icon
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex min-h-12 flex-1 flex-col items-center justify-center gap-1 rounded-lg px-2 text-[11px] font-semibold transition-[color,background-color,box-shadow]",
                active
                  ? "bg-soft-teal text-primary shadow-sm ring-1 ring-primary/15"
                  : "text-muted-foreground hover:bg-muted hover:text-navy",
              )}
            >
              <Icon className="size-4" aria-hidden="true" />
              {t(item.labelKey)}
            </Link>
          )
        })}
      </nav>

      <div className="lg:ms-[240px]">
        <main
          id="main-content"
          tabIndex={-1}
          className="mx-auto w-full max-w-[1200px] scroll-mt-16 px-4 pt-5 pb-28 md:px-6 md:pt-6 lg:pb-10"
        >
          {children}
        </main>
      </div>
    </div>
  )
}
