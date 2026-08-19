"use client"

import type { ReactNode } from "react"
import { useState } from "react"
import { useTranslations } from "next-intl"
import { Link, usePathname } from "@/i18n/navigation"
import { LanguageSwitcher } from "@/components/language-switcher"
import { BrandLockup } from "@/components/brand/brand-lockup"
import { LogoutButton } from "@/features/auth/logout-button"
import { useSession } from "@/features/auth/session-provider"
import { cn } from "@/lib/utils"
import {
  LayoutDashboard,
  Users,
  WalletCards,
  History,
  Send,
  type LucideIcon,
} from "lucide-react"
import { AppShellChevronIcon } from "./app-shell-icons"
import { BrandLogoMark, getInitials } from "./app-shell"

type AdminNavItem = {
  href: string
  labelKey: "navOverview" | "navUsers" | "navRevenue" | "navAudit" | "navPublishing"
  icon: LucideIcon
}

const ADMIN_NAV_ITEMS: AdminNavItem[] = [
  { href: "/admin", labelKey: "navOverview", icon: LayoutDashboard },
  { href: "/admin/users", labelKey: "navUsers", icon: Users },
  { href: "/admin/revenue", labelKey: "navRevenue", icon: WalletCards },
  { href: "/admin/publishing", labelKey: "navPublishing", icon: Send },
  { href: "/admin/audit", labelKey: "navAudit", icon: History },
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  return (
    <div className="relative min-h-dvh overflow-x-clip bg-background text-foreground">
      <a
        href="#main-content"
        className="fixed start-4 top-2 z-50 -translate-y-20 rounded-lg bg-navy px-3 py-2 text-sm font-semibold text-white transition-transform focus-visible:translate-y-0 focus-visible:ring-3 focus-visible:ring-action/50"
      >
        {tc("skipToMain")}
      </a>

      <div className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-[radial-gradient(circle_at_top,var(--color-soft-teal),transparent_62%)] opacity-80" />
      <div className="pointer-events-none absolute end-0 top-20 h-72 w-72 rounded-full bg-action/5 blur-3xl" />

      <aside
        className={cn(
          "fixed inset-y-0 start-0 z-30 hidden flex-col border-e border-border/80 bg-surface/95 shadow-header backdrop-blur transition-[width] duration-300 ease-out lg:flex",
          sidebarCollapsed ? "w-[84px]" : "w-[260px]",
        )}
      >
        <div
          className={cn(
            "relative flex min-h-20 items-center gap-3 px-4",
            sidebarCollapsed && "flex-col justify-center pt-5 pb-3",
          )}
        >
          <Link
            href="/admin"
            className={cn(
              "flex min-w-0 flex-1 items-center gap-3 rounded-lg text-navy outline-none transition-colors hover:text-primary focus-visible:ring-3 focus-visible:ring-ring/40",
              sidebarCollapsed && "flex-none justify-center",
            )}
            aria-label={brandName}
          >
            {sidebarCollapsed ? (
              <BrandLogoMark />
            ) : (
              <span className="min-w-0">
                <BrandLockup
                  label={brandName}
                  markClassName="size-9"
                  wordmarkClassName="text-base"
                />
                <span className="block truncate ps-10 text-xs text-muted-foreground">
                  {tc("tagline")}
                </span>
              </span>
            )}
          </Link>
          <button
            type="button"
            aria-label={
              sidebarCollapsed ? tc("expandSidebar") : tc("collapseSidebar")
            }
            aria-expanded={!sidebarCollapsed}
            onClick={() => setSidebarCollapsed((current) => !current)}
            className={cn(
              "hidden size-9 shrink-0 place-items-center rounded-lg border border-border bg-background text-navy shadow-sm transition hover:border-primary hover:text-primary focus-visible:ring-3 focus-visible:ring-ring/40 lg:grid",
              sidebarCollapsed && "absolute top-5 -end-4 bg-surface",
            )}
          >
            <AppShellChevronIcon collapsed={sidebarCollapsed} />
          </button>
        </div>

        <nav
          aria-label={t("adminNavLabel")}
          className="flex flex-1 flex-col gap-1 px-4 pt-3"
        >
          <ul className="flex flex-col gap-1">
            {ADMIN_NAV_ITEMS.map((item) => {
              const active = isAdminNavItemActive(pathname, item.href)
              const Icon = item.icon
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    title={sidebarCollapsed ? t(item.labelKey) : undefined}
                    className={cn(
                      "flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-semibold transition-[color,background-color,box-shadow] focus-visible:ring-3 focus-visible:ring-ring/40",
                      sidebarCollapsed && "justify-center",
                      active
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "text-muted-foreground hover:bg-soft-teal hover:text-primary",
                    )}
                  >
                    <Icon className="size-5 shrink-0" aria-hidden="true" />
                    <span className={cn(sidebarCollapsed && "sr-only")}>
                      {t(item.labelKey)}
                    </span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </nav>

        <div className="px-4 py-4">
          <AdminUserProfile collapsed={sidebarCollapsed} />
        </div>
      </aside>

      <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-border/70 bg-surface/95 px-4 backdrop-blur lg:hidden">
        <Link
          href="/admin"
          className="flex min-w-0 items-center gap-2 rounded text-navy outline-none focus-visible:ring-2 focus-visible:ring-action"
          aria-label={brandName}
        >
          <BrandLockup
            label={brandName}
            markClassName="size-7"
            wordmarkClassName="text-sm"
          />
        </Link>
        <div className="flex items-center gap-2">
          <LanguageSwitcher />
          <LogoutButton />
        </div>
      </header>

      <nav
        aria-label={t("adminNavLabel")}
        className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-6px_24px_rgba(16,42,67,0.08)] backdrop-blur lg:hidden"
      >
        <div className="mx-auto max-w-[1200px]">
          <ul
            role="list"
            className="flex max-w-full items-center justify-center gap-1 overflow-x-auto px-2 pt-2 pb-1"
          >
            {ADMIN_NAV_ITEMS.map((item) => {
              const active = isAdminNavItemActive(pathname, item.href)
              const Icon = item.icon
              return (
                <li key={item.href} className="w-18 min-w-[4.5rem] flex-none">
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex min-h-12 w-18 flex-col items-center justify-center gap-0.5 rounded-lg px-0.5 py-1 text-center text-[10px] leading-tight font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-action",
                      active
                        ? "bg-soft-teal text-primary"
                        : "text-muted-foreground hover:bg-muted hover:text-primary",
                    )}
                  >
                    <Icon className="size-4" aria-hidden="true" />
                    <span className="max-w-full break-words">
                      {t(item.labelKey)}
                    </span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      </nav>

      <div
        className={cn(
          "relative transition-[margin] duration-300 ease-out",
          sidebarCollapsed ? "lg:ms-[84px]" : "lg:ms-[260px]",
        )}
      >
        <DesktopTopBar />
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

function DesktopTopBar() {
  const t = useTranslations("Admin")
  const tc = useTranslations("Common")

  return (
    <header className="sticky top-0 z-20 hidden border-b border-border/70 bg-background/85 px-6 py-3 backdrop-blur lg:block">
      <div className="mx-auto flex max-w-[1200px] items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-semibold tracking-[0.14em] text-primary uppercase">
            {t("adminConsole")}
          </p>
          <p className="truncate text-sm text-muted-foreground">
            {tc("tagline")}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <LanguageSwitcher />
          <LogoutButton />
        </div>
      </div>
    </header>
  )
}

function AdminUserProfile({ collapsed }: { collapsed: boolean }) {
  const tc = useTranslations("Common")
  const { user, isAuthenticated } = useSession()
  const userInitials = getInitials(user?.fullName)
  const userName = user?.fullName || user?.email || tc("guestUser")

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-lg border border-border bg-background p-2.5 shadow-xs transition-colors",
        collapsed && "justify-center p-2",
      )}
      title={collapsed ? userName : undefined}
    >
      <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-soft-teal text-xs font-bold text-primary ring-1 ring-primary/20">
        {userInitials}
      </span>
      <div className={cn("min-w-0 flex-1", collapsed && "sr-only")}>
        <p className="truncate text-xs font-bold text-foreground">{userName}</p>
        {user?.email && user.fullName ? (
          <p className="truncate text-[11px] text-muted-foreground">
            {user.email}
          </p>
        ) : (
          <p className="truncate text-[11px] text-muted-foreground">
            {isAuthenticated ? tc("signedInAs") : tc("guestUser")}
          </p>
        )}
      </div>
    </div>
  )
}
