"use client"

import type { ReactNode } from "react"
import { useTranslations } from "next-intl"
import { Link, usePathname } from "@/i18n/navigation"
import { LanguageSwitcher } from "@/components/language-switcher"
import { LogoutButton } from "@/features/auth/logout-button"
import { cn } from "@/lib/utils"
import { Shield } from "lucide-react"

type AdminNavItem = {
  href: string
  labelKey: "navOverview" | "navUsers" | "navRevenue"
}

const ADMIN_NAV_ITEMS: AdminNavItem[] = [
  { href: "/admin", labelKey: "navOverview" },
  { href: "/admin/users", labelKey: "navUsers" },
  { href: "/admin/revenue", labelKey: "navRevenue" },
]

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

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(`${href}/`)

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
              const active = isActive(item.href)
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-semibold transition-[color,background-color,box-shadow] focus-visible:ring-3 focus-visible:ring-ring/40",
                      active
                        ? "bg-navy text-white shadow-sm"
                        : "text-muted-foreground hover:bg-muted hover:text-navy",
                    )}
                  >
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
          const active = isActive(item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex min-h-11 flex-1 items-center justify-center rounded-lg px-2 text-xs font-semibold transition-colors",
                active
                  ? "bg-navy text-white"
                  : "text-muted-foreground hover:bg-muted hover:text-navy",
              )}
            >
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
