import { MailIcon } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import { BrandLockup } from '@/components/brand/brand-lockup'
import { Link } from '@/i18n/navigation'
import { FooterLocaleSwitch } from './FooterLocaleSwitch'

type NavLink = { href: string; label: string }

export async function Footer({ locale }: { readonly locale: string }) {
  const footer = await getTranslations('Landing.footer')
  const nav = await getTranslations('Landing.nav')
  const common = await getTranslations('Common')
  const links = nav.raw('links') as NavLink[]

  return (
    <footer className="w-full bg-soft-teal px-4 py-16 sm:px-6">
      <div className="mx-auto grid max-w-content gap-10 md:grid-cols-3">
        <div>
          <BrandLockup
            label={common('appName')}
            markClassName="size-8"
            wordmarkClassName="text-[18px]"
          />
          <p className="mt-3 max-w-xs text-[14px] leading-relaxed text-ink-soft">{footer('body')}</p>
        </div>
        <nav aria-label={footer('navAria')}>
          <h3 className="text-[13px] font-bold text-muted">{footer('linksTitle')}</h3>
          <ul className="mt-3 space-y-2">
            {links.map((link) => (
              <li key={link.href}>
                <a
                  href={`/${locale}${link.href}`}
                  className="rounded text-[14px] text-ink-soft transition-colors hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-action"
                >
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div>
          <h3 className="text-[13px] font-bold text-muted">{footer('contactTitle')}</h3>
          <a
            href={`mailto:${footer('email')}`}
            className="mt-3 inline-flex items-center gap-2 rounded text-[14px] text-ink-soft focus:outline-none focus-visible:ring-2 focus-visible:ring-action"
          >
            <MailIcon className="h-4 w-4" aria-hidden />
            <span className="bidi-iso font-latin">{footer('email')}</span>
          </a>
        </div>
      </div>
      <div className="mx-auto mt-12 flex max-w-content flex-col items-center justify-between gap-3 border-t border-primary/15 pt-6 text-[12px] text-muted sm:flex-row">
        <span>{footer('sourceLine')}</span>
        <div className="flex items-center gap-4">
          <Link
            href="/privacy"
            className="rounded text-[12px] text-muted underline-offset-4 transition-colors hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-action hover:underline"
          >
            {footer('privacy')}
          </Link>
          <Link
            href="/terms"
            className="rounded text-[12px] text-muted underline-offset-4 transition-colors hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-action hover:underline"
          >
            {footer('terms')}
          </Link>
          <FooterLocaleSwitch label={nav('language')} />
        </div>
      </div>
    </footer>
  )
}
