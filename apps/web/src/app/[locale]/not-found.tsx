import { getTranslations } from 'next-intl/server'
import { LanguageSwitcher } from '@/components/language-switcher'
import { BrandLockup } from '@/components/brand/brand-lockup'
import { buttonVariants } from '@/components/ui/button'
import { Link } from '@/i18n/navigation'

export default async function NotFound() {
  const t = await getTranslations('NotFound')
  const common = await getTranslations('Common')

  return (
    <main className="relative min-h-dvh overflow-hidden bg-background px-4 py-5 text-foreground md:px-8 md:py-7">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-[radial-gradient(circle_at_top,var(--color-soft-teal),transparent_66%)]" />
      <div className="relative mx-auto flex min-h-[calc(100dvh-2.5rem)] w-full max-w-content flex-col">
        <header className="flex items-center justify-between gap-4">
          <Link
            href="/"
            className="flex items-center gap-3 rounded-lg text-navy focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <BrandLockup
              label={common('appName')}
              markClassName="size-10"
              wordmarkClassName="text-lg"
            />
          </Link>
          <LanguageSwitcher />
        </header>

        <section className="grid flex-1 items-center gap-10 py-12 lg:grid-cols-[minmax(0,0.9fr)_minmax(340px,1.1fr)] lg:py-16">
          <div aria-hidden="true" className="relative mx-auto w-full max-w-lg select-none">
            <p className="text-center font-latin text-[clamp(7rem,24vw,17rem)] leading-none font-bold tracking-[-0.08em] text-navy/10">
              404
            </p>
            <div className="absolute inset-x-[12%] top-1/2 flex -translate-y-1/2 items-center">
              <span className="h-1 flex-1 rounded-full bg-primary" />
              <span className="size-5 rounded-full border-4 border-background bg-action shadow-[0_0_0_2px_var(--color-navy)]" />
            </div>
          </div>

          <div className="max-w-xl lg:ps-8">
            <p className="mb-3 text-xs font-bold tracking-[0.14em] text-primary uppercase">
              {t('eyebrow')}
            </p>
            <h1 className="text-balance text-4xl leading-tight font-bold text-navy md:text-5xl">
              {t('title')}
            </h1>
            <p className="mt-5 max-w-lg text-pretty text-base leading-8 text-muted-foreground md:text-lg">
              {t('description')}
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/dashboard"
                className={buttonVariants({
                  size: 'lg',
                  className:
                    'min-h-11 border-2 border-navy px-5 shadow-tactile hover:brightness-105 active:translate-y-[2px] active:shadow-tactile-pressed',
                })}
              >
                {t('dashboardAction')}
              </Link>
              <Link
                href="/"
                className={buttonVariants({
                  variant: 'outline',
                  size: 'lg',
                  className: 'min-h-11 px-5',
                })}
              >
                {t('homeAction')}
              </Link>
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}
