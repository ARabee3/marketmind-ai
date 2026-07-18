import { FacebookIcon, InstagramIcon, MailIcon } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import { FooterLocaleSwitch } from './FooterLocaleSwitch'

type NavLink = { href: string; label: string }

export async function Footer() {
  const footer = await getTranslations('Landing.footer')
  const nav = await getTranslations('Landing.nav')
  const links = nav.raw('links') as NavLink[]

  return (
    <footer className="w-full bg-soft-teal px-4 py-16 sm:px-6">
      <div className="mx-auto grid max-w-content gap-10 md:grid-cols-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-full border-[3px] border-surface bg-primary" />
            <span translate="no" className="font-latin text-[18px] font-bold text-navy">
              MarketMind
            </span>
          </div>
          <p className="mt-3 max-w-xs text-[14px] leading-relaxed text-ink-soft">{footer('body')}</p>
        </div>
        <nav aria-label={footer('navAria')}>
          <h3 className="text-[13px] font-bold text-muted">{footer('linksTitle')}</h3>
          <ul className="mt-3 space-y-2">
            {links.map((link) => (
              <li key={link.href}>
                <a
                  href={link.href}
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
            href="mailto:hello@marketmind.ai"
            className="mt-3 inline-flex items-center gap-2 rounded text-[14px] text-ink-soft focus:outline-none focus-visible:ring-2 focus-visible:ring-action"
          >
            <MailIcon className="h-4 w-4" />
            <span className="bidi-iso font-latin">hello@marketmind.ai</span>
          </a>
          <div className="mt-4 flex items-center gap-3">
            <a
              href="#"
              aria-label={footer('facebook')}
              className="rounded-full border border-border bg-surface p-2 text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-action"
            >
              <FacebookIcon className="h-4 w-4" />
            </a>
            <a
              href="#"
              aria-label={footer('instagram')}
              className="rounded-full border border-border bg-surface p-2 text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-action"
            >
              <InstagramIcon className="h-4 w-4" />
            </a>
          </div>
        </div>
      </div>
      <div className="mx-auto mt-12 flex max-w-content flex-col items-center justify-between gap-3 border-t border-primary/15 pt-6 text-[12px] text-muted sm:flex-row">
        <span>{footer('sourceLine')}</span>
        <div className="flex items-center gap-4">
          <FooterLocaleSwitch label={nav('language')} />
          <a href="#" className="rounded hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-action">
            {footer('privacy')}
          </a>
          <a href="#" className="rounded hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-action">
            {footer('terms')}
          </a>
        </div>
      </div>
    </footer>
  )
}