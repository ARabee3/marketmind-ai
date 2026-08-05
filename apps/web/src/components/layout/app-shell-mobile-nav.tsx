"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { AppShellNavIcon, type AppShellIconName } from "./app-shell-icons";

export type AppShellMobileNavItem = {
  readonly href:
    | "/discovery"
    | "/dashboard"
    | "/strategy"
    | "/publishing"
    | "/billing";
  readonly labelKey:
    | "navDiscovery"
    | "navDashboard"
    | "navStrategy"
    | "navPublishing"
    | "navBilling";
  readonly iconName: AppShellIconName;
};

type Props = {
  readonly brandName: string;
  readonly navItems: readonly AppShellMobileNavItem[];
  readonly topActions: ReactNode;
};

export function AppShellMobileNav({ brandName, navItems, topActions }: Props) {
  const t = useTranslations("Common");
  const pathname = usePathname();

  return (
    <>
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-surface/95 px-4 backdrop-blur lg:hidden">
        <Link
          href="/dashboard"
          className="flex min-w-0 items-center gap-2 rounded text-navy outline-none focus-visible:ring-2 focus-visible:ring-action"
          aria-label={brandName}
        >
          <span className="grid size-9 shrink-0 place-items-center rounded-lg border-2 border-navy bg-primary text-sm font-bold text-primary-foreground shadow-tactile">
            M
          </span>
          <span className="hidden truncate text-base font-bold min-[360px]:inline">
            {brandName}
          </span>
        </Link>
        <div className="flex items-center gap-2">{topActions}</div>
      </header>

      <nav
        aria-label={t("mobileNavLabel")}
        className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-6px_24px_rgba(16,42,67,0.08)] backdrop-blur lg:hidden"
      >
        <ul className="mx-auto grid max-w-[1200px] grid-cols-5 gap-1 px-2 pt-2 pb-1">
          {navItems.map((item) => {
            const active =
              pathname === item.href || pathname.startsWith(`${item.href}/`);

            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex min-h-12 flex-col items-center justify-center gap-1 rounded-lg px-1 text-[11px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-action",
                    active
                      ? "bg-soft-teal text-primary"
                      : "text-muted-foreground hover:bg-muted hover:text-primary",
                  )}
                >
                  <AppShellNavIcon name={item.iconName} />
                  <span className="max-w-full truncate">
                    {t(item.labelKey)}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
