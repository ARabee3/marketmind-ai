import { useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import { AnimatePresence, motion } from 'framer-motion';
import { MenuIcon, XIcon } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { useLandingCopy } from '../landing-copy-provider';
import { EASE } from '../lib/motion';

export function Nav() {
  const copy = useLandingCopy();
  const locale = useLocale();
  const targetLocale = locale === 'ar' ? 'en' : 'ar';
  const [scrolled, setScrolled] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    onScroll();
    window.addEventListener('scroll', onScroll, {
      passive: true
    });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  useEffect(() => {
    if (!drawerOpen) return;
    const previousOverflow = document.body.style.overflow;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDrawerOpen(false);
    };
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [drawerOpen]);
  return (
    <motion.header
      initial={{
        y: -32,
        opacity: 0
      }}
      animate={{
        y: 0,
        opacity: 1
      }}
      transition={{
        duration: 0.4,
        ease: EASE.decel
      }}
      className="fixed inset-x-0 top-3 z-50 flex justify-center px-3 sm:top-4 sm:px-4">
      
      <nav
        aria-label={copy.nav.aria}
        className={`mobile-drawer-nav relative z-20 flex w-full max-w-[920px] items-center justify-between gap-3 rounded-full border border-border/80 bg-surface/90 px-2 py-2 text-navy backdrop-blur-md transition-shadow duration-200 ${scrolled ? 'shadow-header' : 'shadow-header'}`}>
        
        <a
          href="#top"
          translate="no"
          onClick={() => setDrawerOpen(false)}
          className="flex items-center gap-2 rounded-full px-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-action">
          
          <span
            className="h-3 w-3 rounded-full border-[3px] border-soft-teal bg-primary"
            aria-hidden />
          
          <span className="font-latin text-[17px] font-bold text-navy">
            MarketMind
          </span>
        </a>
        <ul className="hidden items-center justify-center gap-[5px] md:flex">
          {copy.nav.links.map((link) =>
          <li key={link.href}>
              <a
              href={link.href}
              className="rounded-full px-2 py-2 text-[13px] text-muted transition-colors hover:bg-soft-teal hover:text-navy focus:outline-none focus-visible:ring-2 focus-visible:ring-action">
              
                {link.label}
              </a>
            </li>
          )}
        </ul>
        <Link
          href="/"
          locale={targetLocale}
          className="hidden rounded-full border border-border px-3 py-2 text-[12px] font-bold text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-action md:inline">
          
          {copy.nav.language}
        </Link>
        <div className="hidden items-center gap-2 md:flex">
          <Link
            href="/login"
            className="rounded-full border border-border px-4 py-2 text-[13px] font-bold text-muted transition-colors hover:bg-soft-teal hover:text-navy focus:outline-none focus-visible:ring-2 focus-visible:ring-action">
            
            {copy.nav.login}
          </Link>
          <Link href="/register" className="cta-solid px-4 py-2 text-[13px] font-bold">
            {copy.nav.signup}
          </Link>
        </div>
        <button
          type="button"
          aria-controls="mobile-menu"
          aria-expanded={drawerOpen}
          aria-label={drawerOpen ? copy.nav.closeMenu : copy.nav.openMenu}
          onClick={() => setDrawerOpen((open) => !open)}
          className="grid h-11 w-11 place-items-center rounded-full bg-primary text-white shadow-[0_5px_0_var(--navy)] ring-1 ring-navy/10 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-action md:hidden">
          
          {drawerOpen ?
          <XIcon className="h-6 w-6" aria-hidden /> :
          <MenuIcon className="h-6 w-6" aria-hidden />
          }
        </button>
      </nav>
      <AnimatePresence>
        {drawerOpen &&
        <motion.div
          id="mobile-menu"
          initial={{
            opacity: 0
          }}
          animate={{
            opacity: 1
          }}
          exit={{
            opacity: 0
          }}
          transition={{
            duration: 0.18,
            ease: EASE.micro
          }}
          className="fixed inset-0 z-10 bg-navy/70 backdrop-blur-[2px] md:hidden"
          onClick={() => setDrawerOpen(false)}>
          
          <motion.div
            initial={{
              x: '-100%'
            }}
            animate={{
              x: 0
            }}
            exit={{
              x: '-100%'
            }}
            transition={{
              duration: 0.24,
              ease: EASE.decel
            }}
            className="mobile-drawer-panel fixed inset-y-0 left-0 w-[min(78vw,320px)] border-r border-white/10 bg-[#050807] px-8 pb-8 pt-28 text-white shadow-[28px_0_80px_rgb(0_0_0_/_35%)]"
            onClick={(event) => event.stopPropagation()}>
            
            <ul className="space-y-0 text-right">
              {copy.nav.links.map((link) =>
              <li key={link.href} className="border-b border-white/10">
                  <a
                  href={link.href}
                  onClick={() => setDrawerOpen(false)}
                  className="block py-4 text-[1.55rem] font-bold leading-none text-white transition-colors hover:text-journey-mint focus:outline-none focus-visible:ring-2 focus-visible:ring-journey-mint">
                  
                    {link.label}
                  </a>
                </li>
              )}
            </ul>
            <div className="mt-7 grid gap-3">
              <Link
                href="/register"
                onClick={() => setDrawerOpen(false)}
                className="cta-solid min-h-[42px] px-4 py-2 text-[13px] font-bold">
                
                {copy.nav.signup}
              </Link>
              <Link
                href="/login"
                onClick={() => setDrawerOpen(false)}
                className="rounded-full border border-white/15 bg-white/10 px-4 py-3 text-center text-[13px] font-bold text-white transition-colors hover:bg-white/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-journey-mint">
                
                {copy.nav.login}
              </Link>
              <Link
                href="/"
                locale={targetLocale}
                onClick={() => setDrawerOpen(false)}
                className="rounded-full border border-white/15 bg-white/10 px-4 py-3 font-latin text-[13px] font-bold text-white">
                
                {copy.nav.languageLabel}
              </Link>
            </div>
          </motion.div>
        </motion.div>
        }
      </AnimatePresence>
    </motion.header>);

}
