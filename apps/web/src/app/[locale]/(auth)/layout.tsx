import type { ReactNode } from 'react'
import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { LanguageSwitcher } from '@/components/language-switcher'

type Props = {
  children: ReactNode
}

export default async function AuthLayout({ children }: Props) {
  const t = await getTranslations('Common')
  const auth = await getTranslations('Auth')

  return (
    <main className="relative min-h-dvh overflow-hidden bg-background px-4 py-5 text-foreground md:px-6 md:py-7">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-80 bg-[radial-gradient(circle_at_top,var(--color-soft-teal),transparent_64%)]" />
      <div className="pointer-events-none absolute start-0 top-28 h-72 w-72 rounded-full bg-primary/10 blur-3xl" />
      <div className="relative mx-auto flex min-h-[calc(100dvh-2.5rem)] w-full max-w-content flex-col">
        <header className="flex items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-3 text-navy">
            <span className="grid size-11 place-items-center rounded-lg border-2 border-navy bg-primary text-base font-bold text-primary-foreground shadow-tactile">
              M
            </span>
            <span className="font-latin text-lg font-bold">{t('appName')}</span>
          </Link>
          <LanguageSwitcher />
        </header>

        <div className="grid flex-1 items-center gap-6 py-8 lg:grid-cols-[minmax(0,1fr)_minmax(360px,480px)] lg:gap-10">
          <aside className="relative order-2 overflow-hidden rounded-xl bg-navy p-5 text-primary-foreground shadow-elevated md:p-7 lg:order-none">
            <div className="pointer-events-none absolute -top-24 end-10 h-56 w-56 rounded-full bg-primary/35 blur-3xl" />
            <div className="pointer-events-none absolute -bottom-28 start-8 h-56 w-56 rounded-full bg-journey-mint/25 blur-3xl" />
            <div className="relative grid gap-6">
              <div className="grid gap-3">
                <p className="text-xs font-bold tracking-[0.14em] text-journey-mint uppercase">
                  {auth('authShellEyebrow')}
                </p>
                <h2 className="max-w-xl text-3xl leading-tight font-bold md:text-5xl">
                  {auth('authShellTitle')}
                </h2>
                <p className="max-w-lg text-sm leading-7 text-primary-foreground/75 md:text-base">
                  {auth('authShellBody')}
                </p>
              </div>

              <ol className="grid gap-3">
                {[
                  auth('authShellResearchStep'),
                  auth('authShellProfileStep'),
                  auth('authShellControlStep'),
                ].map((step, index) => (
                  <li
                    key={step}
                    className="flex items-center gap-3 rounded-lg border border-white/15 bg-white/[0.06] p-3"
                  >
                    <span className="grid size-8 shrink-0 place-items-center rounded-full bg-journey-mint text-sm font-bold text-navy">
                      {index + 1}
                    </span>
                    <span className="text-sm font-semibold">{step}</span>
                  </li>
                ))}
              </ol>
            </div>
          </aside>

          <div className="order-1 flex justify-center lg:order-none lg:justify-end">
            {children}
          </div>
        </div>
      </div>
    </main>
  )
}
